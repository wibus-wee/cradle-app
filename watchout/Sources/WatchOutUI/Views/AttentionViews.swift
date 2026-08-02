import SwiftUI
import WatchOutCore

struct AttentionItemRow: View {
  let item: AttentionItem
  let onComplete: () -> Void
  let onReopen: () -> Void
  let onDelete: () -> Void
  let onOpenHref: () -> Void

  var body: some View {
    HStack(alignment: .top, spacing: 10) {
      Button(action: item.status == .open ? onComplete : onReopen) {
        Image(systemName: item.status == .open ? "circle" : "checkmark.circle.fill")
          .foregroundStyle(item.status == .open ? .secondary : Color.accentColor)
          .font(.title3)
      }
      .buttonStyle(.plain)
      .help(item.status == .open ? "Complete" : "Reopen")

      VStack(alignment: .leading, spacing: 4) {
        Text(item.title)
          .font(.body.weight(.medium))
          .strikethrough(item.status == .done)
          .foregroundStyle(item.status == .done ? .secondary : .primary)
        HStack(spacing: 8) {
          Text(item.source)
            .font(.caption2.monospaced())
            .foregroundStyle(.tertiary)
          if let href = item.href {
            Button(href) { onOpenHref() }
              .buttonStyle(.plain)
              .font(.caption2)
              .foregroundStyle(.tint)
              .lineLimit(1)
          }
        }
      }

      Spacer(minLength: 0)

      Button(role: .destructive, action: onDelete) {
        Image(systemName: "trash")
          .font(.caption)
      }
      .buttonStyle(.borderless)
      .help("Delete")
    }
    .padding(.vertical, 4)
  }
}

struct AttentionComposer: View {
  @Binding var title: String
  let onSubmit: () -> Void

  var body: some View {
    HStack(spacing: 8) {
      TextField("Park something for later…", text: $title)
        .textFieldStyle(.roundedBorder)
        .onSubmit(onSubmit)
      Button("Add", action: onSubmit)
        .keyboardShortcut(.return, modifiers: [.command])
        .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }
  }
}

struct AttentionListPane: View {
  @Bindable var model: WatchOutAppModel
  var compact: Bool = false

  var body: some View {
    VStack(alignment: .leading, spacing: compact ? 8 : 12) {
      HStack {
        Text("WatchOut")
          .font(compact ? .headline : .title2.weight(.semibold))
        Spacer()
        Toggle("Show done", isOn: $model.showDone)
          .toggleStyle(.checkbox)
          .controlSize(.small)
          .onChange(of: model.showDone) { _, _ in model.refresh() }
      }

      AttentionComposer(title: $model.draftTitle) {
        model.createFromDraft()
      }

      if let errorMessage = model.errorMessage {
        Text(errorMessage)
          .font(.caption)
          .foregroundStyle(.red)
      }

      if model.items.isEmpty {
        ContentUnavailableView(
          "Nothing parked",
          systemImage: "tray",
          description: Text("Capture a follow-up without interrupting what you’re doing.")
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        List {
          ForEach(model.items) { item in
            AttentionItemRow(
              item: item,
              onComplete: { model.complete(item) },
              onReopen: { model.reopen(item) },
              onDelete: { model.delete(item) },
              onOpenHref: { model.openHref(item) }
            )
          }
        }
        .listStyle(.inset)
      }
    }
    .padding(compact ? 12 : 16)
    .onAppear { model.refresh() }
  }
}
