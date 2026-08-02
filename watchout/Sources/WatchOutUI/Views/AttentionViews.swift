import SwiftUI
import WatchOutCore

struct AttentionItemRow: View {
  let item: AttentionItem
  var focused: Bool = false
  let onComplete: () -> Void
  let onReopen: () -> Void
  let onDelete: () -> Void
  let onOpenHref: () -> Void
  let onEdit: () -> Void
  let onCopy: () -> Void

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
    .background(
      .quaternary.opacity(focused ? 0.55 : 0.35),
      in: RoundedRectangle(cornerRadius: 18, style: .continuous)
    )
    .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    .contextMenu {
      Button("Edit…", action: onEdit)
      Button("Copy", action: onCopy)
      if item.href != nil {
        Button("Open Link", action: onOpenHref)
      }
      Divider()
      if item.status == .open {
        Button("Mark Done", action: onComplete)
      } else {
        Button("Reopen", action: onReopen)
      }
      Button("Delete", role: .destructive, action: onDelete)
    }
    .onTapGesture(count: 2, perform: onEdit)
  }
}

struct AttentionComposer: View {
  @Binding var title: String
  let onSubmit: () -> Void
  var onParkClipboard: (() -> Void)? = nil

  private var canSubmit: Bool {
    !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  var body: some View {
    HStack(spacing: 8) {
      TextField("Park for later…", text: $title)
        .textFieldStyle(.plain)
        .onSubmit(onSubmit)

      if let onParkClipboard {
        Button(action: onParkClipboard) {
          Image(systemName: "clipboard")
        }
        .buttonStyle(.borderless)
        .help("Park clipboard")
      }

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

struct AttentionSearchField: View {
  @Binding var text: String
  let onChange: (String) -> Void

  var body: some View {
    HStack(spacing: 6) {
      Image(systemName: "magnifyingglass")
        .foregroundStyle(.tertiary)
      TextField("Search", text: $text)
        .textFieldStyle(.plain)
        .onChange(of: text) { _, newValue in
          onChange(newValue)
        }
      if !text.isEmpty {
        Button {
          text = ""
          onChange("")
        } label: {
          Image(systemName: "xmark.circle.fill")
            .foregroundStyle(.tertiary)
        }
        .buttonStyle(.plain)
      }
    }
    .font(.callout)
    .padding(.horizontal, 10)
    .padding(.vertical, 7)
    .background(.quaternary.opacity(0.35), in: Capsule(style: .continuous))
  }
}

struct AttentionEditSheet: View {
  @Bindable var model: WatchOutAppModel

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Edit")
        .font(.headline)

      TextField("Title", text: $model.editTitle)
        .textFieldStyle(.roundedBorder)

      TextEditor(text: $model.editBody)
        .font(.body)
        .frame(minHeight: 120)
        .overlay(
          RoundedRectangle(cornerRadius: 8, style: .continuous)
            .strokeBorder(.quaternary, lineWidth: 1)
        )

      HStack {
        Spacer()
        Button("Cancel") { model.cancelEditing() }
          .keyboardShortcut(.cancelAction)
        Button("Save") { model.saveEditing() }
          .keyboardShortcut(.defaultAction)
          .disabled(model.editTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      }
    }
    .padding(16)
    .frame(width: 360)
  }
}

struct AttentionListPane: View {
  @Bindable var model: WatchOutAppModel
  var compact: Bool = false

  var body: some View {
    VStack(spacing: 10) {
      header
        .padding(.horizontal, 4)

      AttentionSearchField(text: $model.searchText) { value in
        model.setSearchText(value)
      }
      .padding(.horizontal, 2)

      if let errorMessage = model.errorMessage {
        Text(errorMessage)
          .font(.caption)
          .foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, 4)
      } else if model.canUndoDelete {
        HStack(spacing: 8) {
          Text("Deleted “\(model.lastDeleted?.title ?? "")”")
            .font(.caption)
            .foregroundStyle(.secondary)
            .lineLimit(1)
          Spacer(minLength: 0)
          Button("Undo") { model.undoDelete() }
            .buttonStyle(.bordered)
            .controlSize(.mini)
            .keyboardShortcut("z", modifiers: .command)
          Button {
            model.dismissUndo()
          } label: {
            Image(systemName: "xmark")
          }
          .buttonStyle(.plain)
          .foregroundStyle(.tertiary)
        }
        .padding(.horizontal, 4)
      } else if let statusMessage = model.statusMessage {
        Text(statusMessage)
          .font(.caption)
          .foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, 4)
      }

      Group {
        if model.items.isEmpty {
          ContentUnavailableView {
            Label(
              model.searchText.isEmpty ? "Nothing parked" : "No matches",
              systemImage: model.searchText.isEmpty ? "tray" : "magnifyingglass"
            )
          } description: {
            Text(
              model.searchText.isEmpty
                ? "Park something before you context-switch."
                : "Try a different search."
            )
          }
        } else {
          ScrollView {
            LazyVStack(spacing: 8) {
              ForEach(model.items) { item in
                AttentionItemRow(
                  item: item,
                  focused: model.focusedItemId == item.id,
                  onComplete: { model.complete(item) },
                  onReopen: { model.reopen(item) },
                  onDelete: { model.delete(item) },
                  onOpenHref: { model.openHref(item) },
                  onEdit: { model.beginEditing(item) },
                  onCopy: { model.copyItem(item) }
                )
                .onAppear {
                  if model.focusedItemId == item.id {
                    // Clear focus after first paint so it does not stick forever.
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
                      if model.focusedItemId == item.id {
                        model.clearFocusedItem()
                      }
                    }
                  }
                }
              }
            }
            .padding(.horizontal, 2)
          }
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)

      AttentionComposer(
        title: $model.draftTitle,
        onSubmit: { model.createFromDraft() },
        onParkClipboard: { model.parkClipboard() }
      )
    }
    .padding(10)
    .onAppear { model.refresh() }
    .sheet(isPresented: Binding(
      get: { model.editingItem != nil },
      set: { if !$0 { model.cancelEditing() } }
    )) {
      AttentionEditSheet(model: model)
    }
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

      Toggle("Done", isOn: Binding(
        get: { model.showDone },
        set: { model.setShowDone($0) }
      ))
      .toggleStyle(.button)
      .controlSize(.small)
    }
  }
}
