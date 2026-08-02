import SwiftUI
import WatchOutCore

struct AttentionItemRow: View {
  let item: AttentionItem
  let onComplete: () -> Void
  let onReopen: () -> Void
  let onDelete: () -> Void
  let onOpenHref: () -> Void

  @State private var hovering = false

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      Button(action: item.status == .open ? onComplete : onReopen) {
        ZStack {
          Circle()
            .strokeBorder(
              item.status == .open ? WatchOutTheme.accent.opacity(0.55) : WatchOutTheme.accent,
              lineWidth: 1.5
            )
            .frame(width: 22, height: 22)
          if item.status == .done {
            Image(systemName: "checkmark")
              .font(.system(size: 10, weight: .bold))
              .foregroundStyle(WatchOutTheme.accent)
              .transition(
                .asymmetric(
                  insertion: .scale(scale: 0.25).combined(with: .opacity),
                  removal: .opacity
                )
              )
          }
        }
        .frame(width: 28, height: 28)
        .contentShape(Rectangle())
      }
      .buttonStyle(WatchOutPressableButtonStyle())
      .help(item.status == .open ? "Mark done" : "Reopen")
      .accessibilityLabel(item.status == .open ? "Complete \(item.title)" : "Reopen \(item.title)")

      VStack(alignment: .leading, spacing: 5) {
        Text(item.title)
          .font(.system(.body, design: .default).weight(.semibold))
          .foregroundStyle(item.status == .done ? WatchOutTheme.inkSecondary : .primary)
          .strikethrough(item.status == .done, color: WatchOutTheme.inkSecondary)
          .multilineTextAlignment(.leading)
          .frame(maxWidth: .infinity, alignment: .leading)

        if let body = item.body, !body.isEmpty {
          Text(body)
            .font(.callout)
            .foregroundStyle(WatchOutTheme.inkSecondary)
            .lineLimit(2)
        }

        HStack(spacing: 8) {
          MetaChip(text: item.source)
          MetaChip(text: item.audience.rawValue)
          Text(item.createdAt.formatted(.relative(presentation: .named)))
            .font(.caption.monospacedDigit())
            .foregroundStyle(.tertiary)
          if item.href != nil {
            Button(action: onOpenHref) {
              Label("Open", systemImage: "arrow.up.right")
                .labelStyle(.titleAndIcon)
                .font(.caption.weight(.medium))
            }
            .buttonStyle(.plain)
            .foregroundStyle(WatchOutTheme.accent)
          }
        }
      }

      Button(role: .destructive, action: onDelete) {
        Image(systemName: "trash")
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(.secondary)
          .frame(width: 28, height: 28)
          .background(
            Circle().fill(hovering ? Color.red.opacity(0.12) : .clear)
          )
      }
      .buttonStyle(WatchOutPressableButtonStyle())
      .opacity(hovering ? 1 : 0)
      .help("Delete")
      .accessibilityLabel("Delete \(item.title)")
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 11)
    .background(
      RoundedRectangle(cornerRadius: WatchOutTheme.rowCorner, style: .continuous)
        .fill(hovering ? WatchOutTheme.rowFillHover : WatchOutTheme.rowFill)
    )
    .overlay(
      RoundedRectangle(cornerRadius: WatchOutTheme.rowCorner, style: .continuous)
        .strokeBorder(WatchOutTheme.hairline, lineWidth: 1)
    )
    .onHover { hovering = $0 }
    .animation(.easeOut(duration: 0.15), value: hovering)
    .animation(.easeOut(duration: 0.18), value: item.status)
  }
}

private struct MetaChip: View {
  let text: String

  var body: some View {
    Text(text)
      .font(.caption2.weight(.medium).monospaced())
      .foregroundStyle(WatchOutTheme.inkSecondary)
      .padding(.horizontal, 6)
      .padding(.vertical, 2)
      .background(
        RoundedRectangle(cornerRadius: 5, style: .continuous)
          .fill(Color.primary.opacity(0.05))
      )
  }
}

struct AttentionComposer: View {
  @Binding var title: String
  @FocusState private var focused: Bool
  let onSubmit: () -> Void

  private var canSubmit: Bool {
    !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: "plus")
        .font(.system(size: 13, weight: .bold))
        .foregroundStyle(focused ? WatchOutTheme.accent : .tertiary)
        .frame(width: 18)

      TextField("Park something for later…", text: $title)
        .textFieldStyle(.plain)
        .font(.body.weight(.medium))
        .focused($focused)
        .onSubmit(onSubmit)

      Button(action: onSubmit) {
        Text("Add")
          .font(.caption.weight(.semibold))
          .padding(.horizontal, 10)
          .padding(.vertical, 6)
          .background(
            Capsule(style: .continuous)
              .fill(canSubmit ? WatchOutTheme.accent : Color.primary.opacity(0.08))
          )
          .foregroundStyle(canSubmit ? Color.white : Color.secondary)
      }
      .buttonStyle(WatchOutPressableButtonStyle())
      .disabled(!canSubmit)
      .keyboardShortcut(.return, modifiers: [.command])
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 11)
    .background(
      RoundedRectangle(cornerRadius: WatchOutTheme.controlCorner, style: .continuous)
        .fill(Color.primary.opacity(focused ? 0.05 : 0.035))
    )
    .overlay(
      RoundedRectangle(cornerRadius: WatchOutTheme.controlCorner, style: .continuous)
        .strokeBorder(
          focused ? WatchOutTheme.accent.opacity(0.45) : WatchOutTheme.hairline,
          lineWidth: 1
        )
    )
    .animation(.easeOut(duration: 0.15), value: focused)
  }
}

struct AttentionEmptyState: View {
  var compact: Bool

  var body: some View {
    VStack(spacing: 14) {
      ZStack {
        Circle()
          .fill(WatchOutTheme.accentSoft)
          .frame(width: compact ? 56 : 72, height: compact ? 56 : 72)
        Image(systemName: "eye.slash")
          .font(.system(size: compact ? 22 : 28, weight: .semibold))
          .foregroundStyle(WatchOutTheme.accent)
      }
      VStack(spacing: 6) {
        Text("Nothing to watch")
          .font(compact ? .headline : .title3.weight(.semibold))
        Text("When something finishes and you can’t review yet,\npark it here. Opening a chat won’t clear it.")
          .font(.callout)
          .foregroundStyle(WatchOutTheme.inkSecondary)
          .multilineTextAlignment(.center)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .padding(.horizontal, 20)
  }
}

struct AttentionListPane: View {
  @Bindable var model: WatchOutAppModel
  var compact: Bool = false

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      header
        .padding(.horizontal, compact ? 14 : 18)
        .padding(.top, compact ? 14 : 18)
        .padding(.bottom, 12)

      AttentionComposer(title: $model.draftTitle) {
        model.createFromDraft()
      }
      .padding(.horizontal, compact ? 14 : 18)
      .padding(.bottom, 12)

      if let errorMessage = model.errorMessage {
        Text(errorMessage)
          .font(.caption)
          .foregroundStyle(.red)
          .padding(.horizontal, compact ? 14 : 18)
          .padding(.bottom, 8)
      }

      Divider().opacity(0.5)

      Group {
        if model.items.isEmpty {
          AttentionEmptyState(compact: compact)
        } else {
          ScrollView {
            LazyVStack(spacing: 8) {
              ForEach(Array(model.items.enumerated()), id: \.element.id) { index, item in
                AttentionItemRow(
                  item: item,
                  onComplete: { model.complete(item) },
                  onReopen: { model.reopen(item) },
                  onDelete: { model.delete(item) },
                  onOpenHref: { model.openHref(item) }
                )
                .transition(.asymmetric(
                  insertion: .opacity.combined(with: .move(edge: .top)),
                  removal: .opacity.combined(with: .scale(scale: 0.98))
                ))
                .animation(
                  .easeOut(duration: 0.2).delay(Double(min(index, 6)) * 0.03),
                  value: model.items.map(\.id)
                )
              }
            }
            .padding(.horizontal, compact ? 14 : 18)
            .padding(.vertical, 12)
          }
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .onAppear { model.refresh() }
  }

  private var header: some View {
    HStack(alignment: .center, spacing: 12) {
      WatchOutMark(size: compact ? 24 : 30)
      VStack(alignment: .leading, spacing: 2) {
        Text("WatchOut")
          .font(compact ? .title3.weight(.bold) : .largeTitle.weight(.bold))
          .tracking(-0.4)
        Text(compact ? "Parking slips" : "Things to handle later")
          .font(.caption)
          .foregroundStyle(WatchOutTheme.inkSecondary)
      }
      Spacer(minLength: 8)
      WatchOutBadge(count: model.openCount)
      Button {
        model.showDone.toggle()
        model.refresh()
      } label: {
        Image(systemName: model.showDone ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
          .font(.system(size: 16, weight: .semibold))
          .foregroundStyle(model.showDone ? WatchOutTheme.accent : .secondary)
          .frame(width: 28, height: 28)
          .contentShape(Rectangle())
      }
      .buttonStyle(WatchOutPressableButtonStyle())
      .help(model.showDone ? "Hide completed" : "Show completed")
    }
  }
}
