import SwiftUI
import WatchOutCore

struct AttentionItemRow: View {
  let item: AttentionItem
  let onComplete: () -> Void
  let onReopen: () -> Void
  let onDelete: () -> Void
  let onOpenHref: () -> Void

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      Button(action: item.status == .open ? onComplete : onReopen) {
        Image(systemName: item.status == .open ? "circle" : "checkmark.circle.fill")
          .font(.body)
          .foregroundStyle(item.status == .open ? WatchOutTheme.secondary : WatchOutTheme.phosphor)
      }
      .buttonStyle(.plain)
      .help(item.status == .open ? "Mark done" : "Reopen")

      VStack(alignment: .leading, spacing: 2) {
        Text(item.title)
          .font(.body.weight(.medium))
          .strikethrough(item.status == .done)
          .foregroundStyle(item.status == .done ? WatchOutTheme.secondary : WatchOutTheme.ink)
          .lineLimit(2)

        HStack(spacing: 6) {
          Text(item.source)
          Text("·")
          Text(item.createdAt, format: .relative(presentation: .named))
          if item.href != nil {
            Button("Open", action: onOpenHref)
              .buttonStyle(.plain)
              .foregroundStyle(WatchOutTheme.phosphor)
          }
        }
        .font(.caption)
        .foregroundStyle(WatchOutTheme.secondary)
      }

      Spacer(minLength: 0)

      Button(role: .destructive, action: onDelete) {
        Image(systemName: "trash")
          .font(.caption)
      }
      .buttonStyle(.borderless)
    }
    .padding(.vertical, 4)
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
        .buttonStyle(.borderedProminent)
        .tint(WatchOutTheme.phosphor)
        .disabled(!canSubmit)
        .keyboardShortcut(.return, modifiers: [.command])
        .controlSize(.small)
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 8)
  }
}

struct AttentionListPane: View {
  @Bindable var model: WatchOutAppModel
  var compact: Bool = false

  var body: some View {
    VStack(spacing: 0) {
      header
        .padding(.horizontal, 10)
        .padding(.top, 8)
        .padding(.bottom, 6)

      Divider()

      if let errorMessage = model.errorMessage {
        Text(errorMessage)
          .font(.caption)
          .foregroundStyle(.red)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, 10)
          .padding(.vertical, 4)
      }

      if model.items.isEmpty {
        ContentUnavailableView {
          Label("Nothing parked", systemImage: "tray")
        } description: {
          Text("Park something before you context-switch.")
        }
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
            .listRowInsets(EdgeInsets(top: 2, leading: 10, bottom: 2, trailing: 10))
            .listRowSeparator(.visible)
          }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
      }

      Divider()

      AttentionComposer(title: $model.draftTitle) {
        model.createFromDraft()
      }
    }
    .onAppear { model.refresh() }
  }

  private var header: some View {
    HStack(spacing: 8) {
      Circle()
        .fill(model.openCount > 0 ? WatchOutTheme.phosphor : WatchOutTheme.secondary.opacity(0.35))
        .frame(width: 7, height: 7)

      Text("WatchOut")
        .font(compact ? .headline : .title3.weight(.semibold))

      if model.openCount > 0 {
        Text("\(model.openCount)")
          .font(.caption.monospacedDigit().weight(.semibold))
          .foregroundStyle(WatchOutTheme.secondary)
      }

      Spacer(minLength: 8)

      Toggle(isOn: $model.showDone) {
        Text("Done")
          .font(.caption)
      }
      .toggleStyle(.checkbox)
      .controlSize(.small)
      .onChange(of: model.showDone) { _, _ in model.refresh() }
    }
  }
}
