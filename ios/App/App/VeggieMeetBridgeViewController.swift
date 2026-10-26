import Capacitor
import UIKit

/// Registers the plugins that live in this app target rather than in an SPM
/// package. Capacitor only auto-registers the classes listed in
/// `capacitor.config.json`, which `cap sync` regenerates from npm packages.
class VeggieMeetBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(AppleSignInPlugin())
    }
}
