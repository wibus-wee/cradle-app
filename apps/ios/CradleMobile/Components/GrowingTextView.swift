import SwiftUI
import UIKit

struct GrowingTextView: UIViewRepresentable {
    @Binding var text: String
    @Binding var measuredHeight: CGFloat
    let placeholder: String
    let onSubmit: @MainActor @Sendable () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> UITextView {
        let textView = UITextView()
        textView.delegate = context.coordinator
        textView.backgroundColor = .clear
        textView.font = .preferredFont(forTextStyle: .body)
        textView.adjustsFontForContentSizeCategory = true
        textView.isScrollEnabled = false
        textView.textContainerInset = UIEdgeInsets(top: 7, left: 0, bottom: 7, right: 0)
        textView.textContainer.lineFragmentPadding = 0
        textView.returnKeyType = .default
        textView.accessibilityLabel = placeholder
        return textView
    }

    func updateUIView(_ textView: UITextView, context: Context) {
        if textView.text != text {
            textView.text = text
        }
        context.coordinator.parent = self
        Self.measure(textView, binding: $measuredHeight)
    }

    private static func measure(_ textView: UITextView, binding: Binding<CGFloat>) {
        let width = textView.bounds.width
        guard width > 0 else { return }
        let size = textView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        if abs(binding.wrappedValue - size.height) > 0.5 {
            DispatchQueue.main.async { binding.wrappedValue = size.height }
        }
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: GrowingTextView

        init(parent: GrowingTextView) {
            self.parent = parent
        }

        func textViewDidChange(_ textView: UITextView) {
            parent.text = textView.text
            GrowingTextView.measure(textView, binding: parent.$measuredHeight)
        }

        func textView(
            _ textView: UITextView,
            shouldChangeTextIn range: NSRange,
            replacementText text: String
        ) -> Bool {
            if text == "\n", textView.text.last == "\n" {
                parent.onSubmit()
                return false
            }
            return true
        }
    }
}
