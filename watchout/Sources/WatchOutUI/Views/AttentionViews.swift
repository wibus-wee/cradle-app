import SwiftUI
import WatchOutCore

struct AttentionItemRow: View {
  let item: AttentionItem
  let onComplete: () -> Void
  let onReopen: () -> Void
  let onDelete: () -> Void
  let onOpenHref: () -> Void

  var body: some View {
    HStack(spacing: 10) {
      Button(action: item.status == .open ? onComplete : onReopen) {
        Image(systemName: item.status == .open ? "circle" : "checkmark.circle.fill")
          .font(.body)
          .foregroundStyle(.secondary)
          .frame(width: 20, height: 20)
      }
      .buttonStyle(.plain)
      .help(item.status == .open ? "Mark done" : "Reopen")

      VStack(alignment: .leading, spacing: 2) {
        Text(item.title)
          .font(.body.weight(.medium))
          .strikethrough(item.status == .done)
          .foregroundStyle(item.status == .done ? .secondary : .primary)
          .lineLimit(2)

        HStack(spacing: 6) {
          Text(item.source)
          Text(item.createdAt, format: .relative(presentation: .named))
          if item.href != nil {
            Button("Open", action: onOpenHref)
              .buttonStyle(.plain)
              .foregroundStyle(.secondary)
          }
        }
        .font(.caption)
        .foregroundStyle(.tertiary)
      }

      Spacer(minLength: 0)

      Button(role: .destructive, action: onDelete) {
        Image(systemName: "xmark")
          .font(.caption.weight(.semibold))
          .foregroundStyle(.tertiary)
          .frame(width: 22, height: 22)
          .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .help("Delete")
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 10)
    .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
  }
}

struct AttentionComposer: View {
  @Binding var title: String
  let onSubmit: () -> Void

  private var canSubmit: Bool {
    !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  var body: some View {
    HStack(spacing: 8) {
      TextField("Park for later…", text: $title)
        .textFieldStyle(.plain)
        .onSubmit(onSubmit)

      Button("Park", action: onSubmit)
        .buttonStyle(.bordered)
        .controlSize(.small)
        .disabled(!canSubmit)
        .keyboardShortcut(.return, modifiers: [.command])
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 10)
    .background(.quaternary.opacity(0.45), in: Capsule(style: .continuous))
  }
}

struct AttentionListPane: View {
  @Bindable var model: WatchOutAppModel
  var compact: Bool = false

  var body: some View {
    VStack(spacing: 10) {
      header
        .padding(.horizontal, 4)

      if let errorMessage = model.errorMessage {
        Text(errorMessage)
          .font(.caption)
          .foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, 4)
      }

      Group {
        if model.items.isEmpty {
          ContentUnavailableView {
            Label("Nothing parked", systemImage: "tray")
          } description: {
            Text("Park something before you context-switch.")
          }
        } else {
          ScrollView {
            LazyVStack(spacing: 8) {
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
            .padding(.horizontal, 2)
          }
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)

      AttentionComposer(title: $model.draftTitle) {
        model.createFromDraft()
      }
    }
    .padding(10)
    .onAppear { model.refresh() }
  }

  private var header: some View {
    HStack(spacing: 8) {
      Text("WatchOut")
        .font(compact ? .headline : .title3.weight(.semibold))

      if model.openCount > 0 {
        Text("\(model.openCount)")
          .font(.caption.monospacedDigit().weight(.semibold))
          .foregroundStyle(.secondary)
          .padding(.horizontal, 8)
          .padding(.vertical, 3)
          .background(.quaternary.opacity(0.5), in: Capsule())
      }

      Spacer(minLength: 8)

      Toggle("Done", isOn: $model.showDone)
        .toggleStyle(.button)
        .controlSize(.small)
        .onChange(of: model.showDone) { _, _ in model.refresh() }
    }
  }
}
