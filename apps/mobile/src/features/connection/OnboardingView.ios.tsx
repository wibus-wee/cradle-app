import {
  Button,
  Host,
  HStack,
  Image,
  ProgressView,
  ScrollView,
  SecureField,
  Spacer,
  Text,
  TextField,
  useNativeState,
  VStack,
} from '@expo/ui/swift-ui'
import {
  autocorrectionDisabled,
  buttonStyle,
  controlSize,
  disabled,
  font,
  foregroundStyle,
  frame,
  keyboardType,
  onSubmit,
  padding,
  submitLabel,
  textContentType,
  textFieldStyle,
  textInputAutocapitalization,
} from '@expo/ui/swift-ui/modifiers'
import { useState } from 'react'

import type { OnboardingViewProps } from './onboarding-view-contract'

export type { OnboardingViewProps } from './onboarding-view-contract'

const fullWidth = frame({ maxWidth: Infinity, alignment: 'leading' })
const fieldStyle = textFieldStyle('roundedBorder')
const inputBehavior = [
  autocorrectionDisabled(),
  textInputAutocapitalization('never'),
]

export function OnboardingView({
  defaultUrl = '',
  error = null,
  isConnecting = false,
  onConnect,
}: OnboardingViewProps) {
  const urlText = useNativeState(defaultUrl)
  const tokenText = useNativeState('')
  const [url, setUrl] = useState(defaultUrl)
  const [token, setToken] = useState('')
  const canConnect = Boolean(url.trim()) && !isConnecting
  const connect = () => {
    if (canConnect) { onConnect(url, token) }
  }

  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      <ScrollView>
        <VStack
          alignment="leading"
          modifiers={[padding({ bottom: 32, horizontal: 24, top: 56 }), fullWidth]}
          spacing={28}
        >
          <VStack alignment="leading" spacing={12}>
            <Image color="blue" size={42} systemName="externaldrive.connected.to.line.below" />
            <Text modifiers={[font({ textStyle: 'largeTitle', weight: 'bold' })]}>Cradle</Text>
          </VStack>

          <VStack alignment="leading" spacing={8}>
            <Text modifiers={[font({ textStyle: 'title2', weight: 'semibold' })]}>
              Connect to Cradle
            </Text>
            <Text modifiers={[foregroundStyle('secondary')]}>
              Use the Server address shown in Cradle Desktop. Your credentials stay on this device.
            </Text>
          </VStack>

          <VStack alignment="leading" spacing={18}>
            <VStack alignment="leading" spacing={7}>
              <Text modifiers={[font({ textStyle: 'footnote', weight: 'semibold' })]}>Server URL</Text>
              <TextField
                modifiers={[
                  fieldStyle,
                  ...inputBehavior,
                  keyboardType('url'),
                  textContentType('URL'),
                  disabled(isConnecting),
                ]}
                onTextChange={setUrl}
                placeholder="http://192.168.1.20:21423"
                text={urlText}
              />
            </VStack>

            <VStack alignment="leading" spacing={7}>
              <HStack modifiers={[fullWidth]}>
                <Text modifiers={[font({ textStyle: 'footnote', weight: 'semibold' })]}>
                  Access Token
                </Text>
                <Spacer />
                <Text modifiers={[font({ textStyle: 'caption' }), foregroundStyle('secondary')]}>Optional</Text>
              </HStack>
              <SecureField
                modifiers={[
                  fieldStyle,
                  ...inputBehavior,
                  submitLabel('go'),
                  onSubmit(connect),
                  disabled(isConnecting),
                ]}
                onTextChange={setToken}
                placeholder="Required for protected servers"
                text={tokenText}
              />
            </VStack>
          </VStack>

          {error && (
            <HStack spacing={10}>
              <Image color="red" size={17} systemName="exclamationmark.circle.fill" />
              <Text modifiers={[font({ textStyle: 'footnote' }), foregroundStyle('red')]}>
                {error}
              </Text>
            </HStack>
          )}

          <Button
            modifiers={[
              buttonStyle('borderedProminent'),
              controlSize('large'),
              disabled(!canConnect),
            ]}
            onPress={connect}
          >
            <HStack modifiers={[frame({ maxWidth: Infinity, minHeight: 44 })]} spacing={10}>
              {isConnecting
                ? <ProgressView />
                : <Image size={17} systemName="arrow.right.circle.fill" />}
              <Text>{isConnecting ? 'Connecting…' : 'Connect to Server'}</Text>
            </HStack>
          </Button>
        </VStack>
      </ScrollView>
    </Host>
  )
}
