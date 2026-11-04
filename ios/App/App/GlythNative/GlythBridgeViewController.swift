// Registers the local GlythNative plugin with the Capacitor bridge.
// Background-task registration lives ONLY in AppDelegate (Apple requires
// launch handlers to be registered before the app finishes launching).
import Capacitor
import UIKit

class GlythBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(GlythNativePlugin())
    }
}
