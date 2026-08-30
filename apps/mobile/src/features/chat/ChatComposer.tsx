import type { MenuAction } from '@expo/ui/community/menu'
import { MenuView } from '@expo/ui/community/menu'
import type { FileUIPart } from 'ai'
import * as ImagePicker from 'expo-image-picker'
import { Plus, Send, X } from 'lucide-react-native'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

import type {
  GetChatSessionsBySessionIdCapabilitiesResponse,
  GetChatSessionsBySessionIdRuntimeSettingsResponse,
} from '@/api-gen'
import { NativeMaterialView } from '@/components/ui/native-material-view'
import { PressableScale } from '@/components/ui/pressable-scale'
import { radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

type Capabilities = GetChatSessionsBySessionIdCapabilitiesResponse
type RuntimeSettings = GetChatSessionsBySessionIdRuntimeSettingsResponse

export interface ChatSubmitInput {
  continuationMode: 'queue' | 'steer'
  files: FileUIPart[]
  text: string
}

export interface ChatComposerDraft {
  files: FileUIPart[]
  text: string
}

export interface ChatComposerProps {
  capabilities?: Capabilities
  clearDraftSignal: number
  initialDraft: ChatComposerDraft
  isSending: boolean
  isStreaming: boolean
  onModeChange: (mode: 'build' | 'plan') => void
  onDraftChange: (draft: ChatComposerDraft) => void
  onSend: (input: ChatSubmitInput) => void
  runtimeSettings?: RuntimeSettings
}

function ChatComposerContent({
  capabilities,
  clearDraftSignal,
  initialDraft,
  isSending,
  isStreaming,
  onModeChange,
  onDraftChange,
  onSend,
  runtimeSettings,
}: ChatComposerProps) {
  const theme = useTheme()
  const [text, setText] = useState(initialDraft.text)
  const [files, setFiles] = useState<FileUIPart[]>(initialDraft.files)
  const textRef = useRef(initialDraft.text)
  const filesRef = useRef<FileUIPart[]>(initialDraft.files)
  const clearDraftSignalRef = useRef(clearDraftSignal)
  const [continuationMode, setContinuationMode] = useState<'queue' | 'steer'>('queue')
  const [isPicking, setIsPicking] = useState(false)
  const interactionMode
    = runtimeSettings?.runtimeSettings.interactionMode === 'plan' ? 'plan' : 'build'
  const composerMenuActions: MenuAction[] = [
    { id: 'photo', image: 'photo.on.rectangle', title: 'Add photo' },
    {
      id: 'build',
      image: 'hammer',
      state: interactionMode === 'build' ? 'on' : 'off',
      title: 'Build',
    },
    {
      id: 'plan',
      image: 'list.bullet.rectangle',
      state: interactionMode === 'plan' ? 'on' : 'off',
      title: 'Plan',
    },
  ]
  const slashQuery = text.match(/(?:^|\s)\/([\w-]*)$/)?.[1] ?? null
  const mentionQuery = text.match(/(?:^|\s)@([\w-]*)$/)?.[1] ?? null
  const slashCommands = useMemo(
    () =>
      (capabilities?.slashCommands ?? [])
        .filter(
          command =>
            slashQuery !== null && command.name.toLowerCase().startsWith(slashQuery.toLowerCase()),
        )
        .slice(0, 5),
    [capabilities?.slashCommands, slashQuery],
  )
  const skills = useMemo(
    () =>
      (capabilities?.skills ?? [])
        .filter(
          skill =>
            mentionQuery !== null && skill.toLowerCase().startsWith(mentionQuery.toLowerCase()),
        )
        .slice(0, 5),
    [capabilities?.skills, mentionQuery],
  )
  const suggestionsVisible = slashCommands.length > 0 || skills.length > 0

  useEffect(() => {
    if (clearDraftSignalRef.current === clearDraftSignal) {
      return
    }
    clearDraftSignalRef.current = clearDraftSignal
    textRef.current = ''
    filesRef.current = []
    setText('')
    setFiles([])
  }, [clearDraftSignal])

  const updateText = (nextText: string) => {
    textRef.current = nextText
    setText(nextText)
    onDraftChange({ files: filesRef.current, text: nextText })
  }

  const updateFiles = (nextFiles: FileUIPart[]) => {
    filesRef.current = nextFiles
    setFiles(nextFiles)
    onDraftChange({ files: nextFiles, text: textRef.current })
  }

  const submit = () => {
    const nextText = text.trim()
    if ((!nextText && files.length === 0) || isSending) {
      return
    }
    onSend({ continuationMode, files, text: nextText })
    Keyboard.dismiss()
  }

  const pickPhoto = async () => {
    if (isPicking) {
      return
    }
    setIsPicking(true)
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsMultipleSelection: true,
        base64: true,
        mediaTypes: ['images'],
        quality: 0.9,
      })
      if (result.canceled) {
        return
      }
      const nextFiles = result.assets.flatMap((asset) => {
        if (!asset.base64) {
          return []
        }
        const mediaType = asset.mimeType ?? 'image/jpeg'
        return [
          {
            filename: asset.fileName ?? `photo-${Date.now()}.jpg`,
            mediaType,
            type: 'file' as const,
            url: `data:${mediaType};base64,${asset.base64}`,
          },
        ]
      })
      updateFiles([...filesRef.current, ...nextFiles])
    }
    finally {
      setIsPicking(false)
    }
  }

  const insertSuggestion = (value: string, kind: 'mention' | 'slash') => {
    const pattern = kind === 'slash' ? /\/([\w-]*)$/ : /@([\w-]*)$/
    updateText(textRef.current.replace(pattern, `${kind === 'slash' ? '/' : '@'}${value} `))
  }

  return (
    <View style={[styles.frame, { backgroundColor: theme.chrome }]}>
      {isStreaming && (
        <View style={[styles.continuation, { backgroundColor: theme.muted }]}>
          {(['queue', 'steer'] as const).map(mode => (
            <PressableScale
              accessibilityLabel={`${mode} next message`}
              accessibilityRole="button"
              key={mode}
              onPress={() => setContinuationMode(mode)}
              style={[
                styles.continuationOption,
                continuationMode === mode && { backgroundColor: theme.surface },
              ]}
            >
              <Text
                style={[
                  styles.continuationText,
                  { color: continuationMode === mode ? theme.foreground : theme.mutedForeground },
                ]}
              >
                {mode === 'queue' ? 'Queue' : 'Steer'}
              </Text>
            </PressableScale>
          ))}
        </View>
      )}

      {suggestionsVisible && (
        <View
          style={[
            styles.suggestions,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          {slashCommands.map(command => (
            <PressableScale
              accessibilityLabel={`Insert ${command.name}`}
              accessibilityRole="button"
              key={command.name}
              onPress={() => insertSuggestion(command.name, 'slash')}
              style={styles.suggestion}
            >
              <Text style={[styles.suggestionTitle, { color: theme.foreground }]}>
                {`/${command.name}`}
              </Text>
              <Text
                numberOfLines={1}
                style={[styles.suggestionDescription, { color: theme.mutedForeground }]}
              >
                {command.description}
              </Text>
            </PressableScale>
          ))}
          {skills.map(skill => (
            <PressableScale
              accessibilityLabel={`Mention ${skill}`}
              accessibilityRole="button"
              key={skill}
              onPress={() => insertSuggestion(skill, 'mention')}
              style={styles.suggestion}
            >
              <Text style={[styles.suggestionTitle, { color: theme.foreground }]}>
                {`@${skill}`}
              </Text>
              <Text style={[styles.suggestionDescription, { color: theme.mutedForeground }]}>
                Skill
              </Text>
            </PressableScale>
          ))}
        </View>
      )}

      {files.length > 0 && (
        <ScrollView
          contentContainerStyle={styles.attachments}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {files.map(file => (
            <View key={file.url} style={[styles.attachment, { backgroundColor: theme.surface }]}>
              <Image source={{ uri: file.url }} style={styles.attachmentImage} />
              <PressableScale
                accessibilityLabel={`Remove ${file.filename ?? 'photo'}`}
                accessibilityRole="button"
                onPress={() =>
                  updateFiles(filesRef.current.filter(item => item.url !== file.url))}
                style={[styles.removeAttachment, { backgroundColor: theme.overlay }]}
              >
                <X color="#fff" size={12} />
              </PressableScale>
            </View>
          ))}
        </ScrollView>
      )}

      <View
        style={[
          styles.composer,
          {
            backgroundColor: 'transparent',
            borderColor: theme.input,
            shadowColor: theme.shadow,
            shadowOpacity: theme.shadowOpacity,
          },
        ]}
      >
        <NativeMaterialView
          glassStyle="regular"
          pointerEvents="none"
          style={styles.glass}
          tintColor={theme.glassTint}
        />
        <MenuView
          actions={composerMenuActions}
          onPressAction={({ nativeEvent }) => {
            if (nativeEvent.event === 'photo') {
              void pickPhoto()
            }
            else if (nativeEvent.event === 'build') {
              onModeChange('build')
            }
            else if (nativeEvent.event === 'plan') {
              onModeChange('plan')
            }
          }}
          style={styles.addMenu}
          title="Composer options"
        >
          <View
            accessibilityLabel="Composer options"
            accessibilityRole="button"
            style={styles.addButton}
          >
            {isPicking
            ? (
              <ActivityIndicator color={theme.mutedForeground} size="small" />
            )
            : (
              <Plus color={theme.tertiaryForeground} size={20} />
            )}
          </View>
        </MenuView>
        <TextInput
          accessibilityLabel="Message"
          blurOnSubmit={false}
          maxLength={12_000}
          multiline
          onChangeText={updateText}
          onSubmitEditing={submit}
          placeholder={
            isStreaming
              ? continuationMode === 'steer'
                ? 'Steer the response…'
                : 'Add to queue…'
              : 'Message…'
          }
          placeholderTextColor={theme.mutedForeground}
          selectionColor={theme.info}
          style={[styles.input, { color: theme.foreground }]}
          value={text}
        />
        <PressableScale
          accessibilityLabel={isStreaming ? `${continuationMode} message` : 'Send message'}
          accessibilityRole="button"
          disabled={(!text.trim() && files.length === 0) || isSending}
          haptic
          onPress={submit}
          style={[
            styles.sendButton,
            { backgroundColor: text.trim() || files.length > 0 ? theme.primary : theme.muted },
          ]}
        >
          {isSending
          ? (
            <ActivityIndicator color={theme.primaryForeground} size="small" />
          )
          : (
            <Send
              color={
                text.trim() || files.length > 0 ? theme.primaryForeground : theme.mutedForeground
              }
              size={16}
              strokeWidth={2.4}
            />
          )}
        </PressableScale>
      </View>
    </View>
  )
}

export const ChatComposer = memo(ChatComposerContent)

const styles = StyleSheet.create({
  addButton: {
    alignItems: 'center',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  addMenu: {
    height: 36,
    width: 36,
  },
  attachment: {
    borderRadius: radius.md,
    height: 64,
    overflow: 'hidden',
    width: 64,
  },
  attachmentImage: {
    height: '100%',
    width: '100%',
  },
  attachments: {
    gap: spacing.sm,
    paddingBottom: spacing.xs,
  },
  composer: {
    alignItems: 'flex-end',
    borderRadius: radius.xxl,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 50,
    overflow: 'hidden',
    padding: 5,
    shadowOffset: { height: 1, width: 0 },
    shadowRadius: 6,
  },
  glass: {
    ...StyleSheet.absoluteFill,
  },
  continuation: {
    borderRadius: radius.lg,
    flexDirection: 'row',
    padding: 2,
  },
  continuationOption: {
    borderRadius: radius.md,
    minWidth: 50,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  continuationText: {
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  frame: {
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    fontSize: 15,
    lineHeight: 21,
    maxHeight: 132,
    minHeight: 38,
    paddingBottom: 8,
    paddingTop: 8,
  },
  removeAttachment: {
    alignItems: 'center',
    borderRadius: 11,
    height: 22,
    justifyContent: 'center',
    position: 'absolute',
    right: 3,
    top: 3,
    width: 22,
  },
  sendButton: {
    alignItems: 'center',
    borderRadius: 19,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  suggestion: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 40,
    paddingHorizontal: spacing.sm,
  },
  suggestionDescription: {
    flex: 1,
    fontSize: 12,
  },
  suggestionTitle: {
    fontFamily: 'GeistMono_400Regular',
    fontSize: 12,
  },
  suggestions: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    paddingVertical: spacing.xs,
  },
})
