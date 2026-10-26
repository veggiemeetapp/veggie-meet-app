import AuthenticationServices
import Capacitor
import Foundation
import UIKit

/// Native Sign in with Apple, exposed to the web layer as the `AppleSignIn`
/// Capacitor plugin (see `src/lib/nativeAppleAuth.ts`).
///
/// Kept inside the app target on purpose: the community plugin pins
/// capacitor-swift-pm 7.x while this app uses Capacitor 8, and the whole
/// feature is one `ASAuthorizationController` round trip.
@objc(AppleSignInPlugin)
public class AppleSignInPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppleSignInPlugin"
    public let jsName = "AppleSignIn"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise),
    ]

    private var pendingCallId: String?
    private var controller: ASAuthorizationController?

    /// `nonce` must be the SHA-256 hex digest of the raw nonce that the web
    /// layer later hands to Supabase, which is how the identity token is bound
    /// to this request.
    @objc func authorize(_ call: CAPPluginCall) {
        guard let nonce = call.getString("nonce"), !nonce.isEmpty else {
            call.reject("A hashed nonce is required.")
            return
        }

        if let previous = pendingCallId, let previousCall = bridge?.savedCall(withID: previous) {
            previousCall.reject("Another Apple sign-in is already in progress.")
            bridge?.releaseCall(previousCall)
        }

        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]
        request.nonce = nonce

        bridge?.saveCall(call)
        pendingCallId = call.callbackId

        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        self.controller = controller

        DispatchQueue.main.async {
            controller.performRequests()
        }
    }

    private func takePendingCall() -> CAPPluginCall? {
        defer {
            pendingCallId = nil
            controller = nil
        }
        guard let id = pendingCallId else { return nil }
        return bridge?.savedCall(withID: id)
    }
}

extension AppleSignInPlugin: ASAuthorizationControllerDelegate {
    public func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        guard let call = takePendingCall() else { return }
        defer { bridge?.releaseCall(call) }

        guard
            let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
            let tokenData = credential.identityToken,
            let identityToken = String(data: tokenData, encoding: .utf8)
        else {
            call.reject("Apple did not return an identity token.")
            return
        }

        var result: [String: Any] = [
            "identityToken": identityToken,
            "user": credential.user,
        ]
        if let email = credential.email { result["email"] = email }
        if let givenName = credential.fullName?.givenName { result["givenName"] = givenName }
        if let familyName = credential.fullName?.familyName { result["familyName"] = familyName }
        call.resolve(result)
    }

    public func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithError error: Error
    ) {
        guard let call = takePendingCall() else { return }
        defer { bridge?.releaseCall(call) }

        let code = (error as? ASAuthorizationError)?.code
        if code == .canceled {
            call.reject("canceled", "canceled")
            return
        }
        call.reject(error.localizedDescription)
    }
}

extension AppleSignInPlugin: ASAuthorizationControllerPresentationContextProviding {
    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        if let window = bridge?.viewController?.view.window {
            return window
        }
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.flatMap(\.windows).first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }
}
