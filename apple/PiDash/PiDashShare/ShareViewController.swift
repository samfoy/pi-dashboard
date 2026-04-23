import UIKit
import SwiftUI

/// Entry point for the PiDashShare extension.
/// Presents the SwiftUI ShareView inside a UIHostingController.
@objc(ShareViewController)
class ShareViewController: UIViewController {

    override func viewDidLoad() {
        super.viewDidLoad()
        // Transparent background so the sheet sits over the host app.
        view.backgroundColor = UIColor.black.withAlphaComponent(0.4)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        presentShareSheet()
    }

    private func presentShareSheet() {
        guard let extensionContext else { return }

        let viewModel = ShareViewModel(extensionContext: extensionContext)
        let shareView = ShareView(viewModel: viewModel) { [weak self] in
            self?.dismiss(animated: true) {
                extensionContext.cancelRequest(withError: NSError(
                    domain: "PiDashShare", code: 0,
                    userInfo: [NSLocalizedDescriptionKey: "Cancelled"]))
            }
        }

        let host = UIHostingController(rootView: shareView)
        host.modalPresentationStyle = .pageSheet
        if let sheet = host.sheetPresentationController {
            sheet.detents = [.medium(), .large()]
            sheet.prefersGrabberVisible = true
            sheet.prefersScrollingExpandsWhenScrolledToEdge = false
        }
        host.presentationController?.delegate = self
        present(host, animated: true)
    }
}

extension ShareViewController: UIAdaptivePresentationControllerDelegate {
    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        extensionContext?.cancelRequest(withError: NSError(
            domain: "PiDashShare", code: 0,
            userInfo: [NSLocalizedDescriptionKey: "Dismissed"]))
    }
}
