import { buildFinanceContext, fallbackAnalysis, validateAnalysis } from './finance.js';
export async function financeBriefing({ state, provider }){
  const ctx=buildFinanceContext(state); const fallback=fallbackAnalysis(ctx);
  if(!ctx.transaction_count) return { analysis:fallback, context:ctx, source:'deterministic' };
  if(provider?.configured&&typeof provider.chat==='function'){
    try{ const text=await provider.chat([{role:'system',content:'You interpret DETERMINISTIC financial figures. Never invent or recalculate numbers; use only the JSON figures (amounts are minor units). Return ONLY JSON: {"headline":"","summary":"","positiveSignals":[],"attentionSignals":[],"observations":[],"recommendedActions":[{"type":"review_subscription|reduce_discretionary_category|protect_surplus|create_spending_target|review_unusual_transaction|increase_savings_target|review_recurring_commitment","title":"","detail":""}],"confidence":0}. Calm, non-alarmist, no regulated investment advice, no guaranteed returns.'},{role:'user',content:JSON.stringify(ctx)}]);
      const parsed=JSON.parse(String(text).replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'')); const v=validateAnalysis(parsed); if(v.ok) return { analysis:v.value, context:ctx, source:'meta', model:provider.model||null };
    }catch{} }
  return { analysis:fallback, context:ctx, source:'deterministic' };
}
