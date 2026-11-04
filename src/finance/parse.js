// CSV + XLSX parsing. XLSX is read as values only (zip + XML); macros/scripts never run.
import zlib from 'node:zlib';
import { parseAmountToMinor, parseDateValue, normalizeMerchant, classifyTransaction, isTransferLike, rowHash } from './finance.js';
export const MAX_BYTES = 15*1024*1024, MAX_ROWS = 50000;
export function parseCSVText(text){
  text=String(text||'').replace(/^\uFEFF/,''); const first=text.split(/\r?\n/)[0]||'';
  const delim=[',',';','\t','|'].map(d=>({d,n:first.split(d).length})).sort((a,b)=>b.n-a.n)[0].d;
  const rows=[]; let row=[],cell='',q=false;
  for(let i=0;i<text.length;i++){ const c=text[i]; if(q){ if(c==='"'){ if(text[i+1]==='"'){cell+='"';i++;} else q=false; } else cell+=c; }
    else if(c==='"') q=true; else if(c===delim){ row.push(cell); cell=''; } else if(c==='\n'){ row.push(cell.replace(/\r$/,'')); rows.push(row); row=[]; cell=''; } else cell+=c; }
  if(cell!==''||row.length){ row.push(cell); rows.push(row); }
  return rows.filter(r=>r.some(c=>String(c).trim()!==''));
}
function zipEntries(buf){
  if(buf.length<22) throw new Error('File is not a valid XLSX workbook.');
  let eocd=-1; for(let i=buf.length-22;i>=Math.max(0,buf.length-65557);i--){ if(buf.readUInt32LE(i)===0x06054b50){eocd=i;break;} }
  if(eocd<0) throw new Error('File is not a valid XLSX workbook.');
  const count=buf.readUInt16LE(eocd+10); let off=buf.readUInt32LE(eocd+16); const entries={};
  for(let n=0;n<count;n++){ if(buf.readUInt32LE(off)!==0x02014b50) break; const method=buf.readUInt16LE(off+10), comp=buf.readUInt32LE(off+20), nameLen=buf.readUInt16LE(off+28), extra=buf.readUInt16LE(off+30), comment=buf.readUInt16LE(off+32), lho=buf.readUInt32LE(off+42); const name=buf.subarray(off+46,off+46+nameLen).toString('utf8');
    const lName=buf.readUInt16LE(lho+26), lExtra=buf.readUInt16LE(lho+28); const start=lho+30+lName+lExtra; const data=buf.subarray(start,start+comp);
    try{ entries[name]=method===8?zlib.inflateRawSync(data):method===0?Buffer.from(data):null; }catch{ entries[name]=null; } off+=46+nameLen+extra+comment; }
  return entries;
}
const xmlUnesc=s=>String(s||'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
const stripTags=s=>xmlUnesc(String(s||'').replace(/<[^>]+>/g,''));
export function parseXLSXBuffer(buf){
  const e=zipEntries(buf); const shared=[]; if(e['xl/sharedStrings.xml']){ for(const m of e['xl/sharedStrings.xml'].toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x=>xmlUnesc(x[1])).join('')); }
  let sheetNames=['Sheet1']; try{ const wb=e['xl/workbook.xml']?.toString('utf8')||''; const names=[...wb.matchAll(/<sheet[^>]*name="([^"]+)"/g)].map(m=>xmlUnesc(m[1])); if(names.length) sheetNames=names; }catch{}
  const sheetFiles=Object.keys(e).filter(k=>/^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort();
  if(!sheetFiles.length) throw new Error('No worksheets found in this XLSX file.');
  const sheets=sheetFiles.map((file,i)=>{ const xml=e[file].toString('utf8'); const rows=[];
    for(const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)){ const cells={}; let max=0;
      for(const cm of rm[1].matchAll(/<c\s+([^>]*?)>([\s\S]*?)<\/c>|<c\s+([^>]*?)\/>/g)){ const attrs=cm[1]||cm[3]||''; const ref=(attrs.match(/r="([A-Z]+)\d+"/)||[])[1]||'A'; let col=0; for(const ch of ref) col=col*26+(ch.charCodeAt(0)-64); col-=1; max=Math.max(max,col);
        const inner=cm[2]||''; const t=(attrs.match(/t="([^"]+)"/)||[])[1]; const v=(inner.match(/<v>([\s\S]*?)<\/v>/)||[])[1]; const isv=inner.match(/<is>([\s\S]*?)<\/is>/);
        let val=''; if(t==='s'&&v!=null) val=shared[Number(v)]??''; else if(isv) val=[...isv[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x=>xmlUnesc(x[1])).join(''); else if(v!=null) val=xmlUnesc(v); cells[col]=val; }
      const row=[]; for(let c=0;c<=max;c++) row.push(cells[c]??''); if(row.some(c=>String(c).trim()!=='')) rows.push(row); }
    return { name:sheetNames[i]||`Sheet ${i+1}`, rows }; });
  return sheets;
}
const ALIASES={ date:['date','transaction date','posted date','booking date','txn date','value date'], description:['description','merchant','reference','details','narrative','name','payee','transaction description'], amount:['amount','value','amt','transaction amount'], debit:['debit','money out','paid out','withdrawal','debits'], credit:['credit','money in','paid in','deposit','credits'], balance:['balance','running balance'], currency:['currency','ccy','curr'], category:['category','type','transaction type'] };
function normHeader(h){ return String(h||'').trim().toLowerCase().replace(/[^a-z ]/g,' ').replace(/\s+/g,' '); }
export function detectSheet(sheets){ const scored=sheets.map(s=>({s,score:detectColumns(s.rows[0]||[]).confidence})); scored.sort((a,b)=>b.score-a.score); return { sheet:scored[0]?.s, plausible:scored.filter(x=>x.score>0.25).map(x=>x.s.name), ambiguous:scored.filter(x=>x.score>0.25).length>1 }; }
export function detectColumns(headers){ const hs=headers.map(normHeader); const mapping={}; let score=0; const used=new Set();
  for(const [field,aliases] of Object.entries(ALIASES)){ let best=-1,bestExact=false; hs.forEach((h,i)=>{ if(used.has(i))return; if(aliases.includes(h)){best=i;bestExact=true;} else if(best<0&&aliases.some(a=>h.includes(a))) best=i; }); if(best>=0){ mapping[field]=best; used.add(best); score+= field==='date'||field==='description'||field==='amount'?0.25:0.08; } }
  if(mapping.amount==null&&(mapping.debit!=null||mapping.credit!=null)) score+=0.2;
  return { mapping, confidence:Math.min(1,Math.round(score*100)/100) };
}
export function detectHeaderRow(rows){ for(let i=0;i<Math.min(10,rows.length);i++){ const d=detectColumns(rows[i]); if(d.confidence>=0.4) return {index:i,...d}; } return {index:0,...detectColumns(rows[0]||[])}; }
export function normaliseRows(rows, mapping, { userId='demo', currencyDefault='GBP', merchantRules=[] }={}){
  const txs=[], rejected=[]; let currencies=new Set();
  rows.forEach((r,idx)=>{ const get=f=>mapping[f]!=null?r[mapping[f]]:undefined;
    const date=parseDateValue(get('date')); const desc=String(get('description')||'').trim();
    let minor=null; if(mapping.amount!=null) minor=parseAmountToMinor(get('amount'));
    else { const d=parseAmountToMinor(get('debit')), c=parseAmountToMinor(get('credit')); if(d!=null||c!=null) minor=(c?Math.abs(c):0)-(d?Math.abs(d):0); if(minor===0&&d==null&&c==null) minor=null; }
    if(!date||!desc||minor==null){ rejected.push({row:idx+1,reason:!date?'missing/invalid date':!desc?'missing description':'missing/invalid amount'}); return; }
    const currency=String(get('currency')||currencyDefault).trim().toUpperCase().slice(0,3)||currencyDefault; currencies.add(currency);
    const merchant=normalizeMerchant(desc); const direction=minor>=0?'in':'out';
    const base={ transaction_date:date, description_raw:desc.slice(0,300), merchant_normalized:merchant, amount_minor:minor, currency, direction, balance_minor:parseAmountToMinor(get('balance')), is_transfer:isTransferLike({description_raw:desc,merchant_normalized:merchant}) };
    const cls=classifyTransaction(base, merchantRules); const tx={ id:`tx_${rowHash(userId,base).slice(0,16)}_${idx}`, ...base, category:cls.category, confidence:cls.confidence, category_source:cls.source, is_recurring:false }; tx.source_row_hash=rowHash(userId,tx); txs.push(tx); });
  return { transactions:txs, rejected, currencies:[...currencies] };
}
