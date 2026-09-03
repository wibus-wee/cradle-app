import {
  Form,
  Host,
  HStack,
  Image,
  Section,
  SecureField,
  Text,
  TextField,
  useNativeState,
} from '@expo/ui/swift-ui'
import {
  autocorrectionDisabled,
  font,
  foregroundStyle,
  keyboardType,
  listStyle,
  onSubmit,
  submitLabel,
  textContentType,
  textInputAutocapitalization,
} from '@expo/ui/swift-ui/modifiers'

import type { ConnectionSettingsViewProps } from './connection-settings-view-contract'

export type { ConnectionSetting, ConnectionSettingsViewProps } from './connection-settings-view-contract'

const secondaryForeground = foregroundStyle({ type: 'hierarchical', style: 'secondary' })

export function ConnectionSettingsView({
  error = null,
  onChangeValue,
  onSubmit: submit,
  setting,
  value,
}: ConnectionSettingsViewProps) {
  const text = useNativeState(value)
  const isServer = setting === 'server'
  const sharedModifiers = [
    autocorrectionDisabled(),
    textInputAutocapitalization('never'),
    submitLabel('done'),
    onSubmit(submit),
  ]

  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      <Form modifiers={[listStyle('insetGrouped')]}>
        <Section
          footer={(
            <Text modifiers={[secondaryForeground]}>
              {isServer
                ? 'Use the Server address shown in Cradle Desktop.'
                : 'Leave this empty when the Server does not require authentication.'}
            </Text>
          )}
          title={isServer ? 'Server' : 'Authentication'}
        >
          {isServer
            ? (
                <TextField
                  autoFocus
                  modifiers={[
                    ...sharedModifiers,
                    keyboardType('url'),
                    textContentType('URL'),
                  ]}
                  onTextChange={onChangeValue}
                  placeholder="http://192.168.1.20:21423"
                  text={text}
                />
              )
            : (
                <SecureField
                  autoFocus
                  modifiers={sharedModifiers}
                  onTextChange={onChangeValue}
                  placeholder="Access token (optional)"
                  text={text}
                />
              )}
        </Section>

        {error && (
          <Section>
            <HStack spacing={10}>
              <Image color="red" size={17} systemName="exclamationmark.circle.fill" />
              <Text modifiers={[font({ textStyle: 'footnote' }), foregroundStyle('red')]}>
                {error}
              </Text>
            </HStack>
          </Section>
        )}
      </Form>
    </Host>
  )
}
