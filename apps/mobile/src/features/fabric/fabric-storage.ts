import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'

import type { FabricMetadataState, FabricSecretState, MobileFabricMembership, PendingFabricControllerEnrollment } from './fabric-types'
import {
  FABRIC_STORAGE_SCHEMA_VERSION,
} from './fabric-types'

const FABRIC_METADATA_KEY = 'cradle.mobile.fabric.metadata.v1'
const FABRIC_SECRETS_KEY = 'cradle.mobile.fabric.secrets.v1'

const EMPTY_METADATA: FabricMetadataState = {
  schemaVersion: FABRIC_STORAGE_SCHEMA_VERSION,
  pending: null,
  membership: null,
}

async function readSecrets(): Promise<FabricSecretState | null> {
  if (Platform.OS === 'web') {
    const insecureSecrets = await AsyncStorage.getItem(FABRIC_SECRETS_KEY)
    if (insecureSecrets) {
      throw new Error('Fabric private keys cannot be restored without native secure storage.')
    }
    return null
  }
  const raw = await import('expo-secure-store')
    .then(store => store.getItemAsync(FABRIC_SECRETS_KEY))
  if (!raw) {
    return null
  }
  const secrets = JSON.parse(raw) as FabricSecretState
  if (secrets.schemaVersion !== FABRIC_STORAGE_SCHEMA_VERSION) {
    throw new Error('The saved Fabric identity uses an unsupported storage version.')
  }
  return secrets
}

async function writeSecrets(secrets: FabricSecretState | null): Promise<void> {
  if (Platform.OS === 'web') {
    if (secrets) {
      throw new Error('Fabric enrollment requires the native iOS or Android app.')
    }
    else {
      await AsyncStorage.removeItem(FABRIC_SECRETS_KEY)
    }
    return
  }

  const store = await import('expo-secure-store')
  if (secrets) {
    await store.setItemAsync(FABRIC_SECRETS_KEY, JSON.stringify(secrets), {
      keychainAccessible: store.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    })
  }
  else {
    await store.deleteItemAsync(FABRIC_SECRETS_KEY)
  }
}

async function readMetadata(): Promise<FabricMetadataState> {
  const raw = await AsyncStorage.getItem(FABRIC_METADATA_KEY)
  if (!raw) {
    return EMPTY_METADATA
  }
  const metadata = JSON.parse(raw) as FabricMetadataState
  if (metadata.schemaVersion !== FABRIC_STORAGE_SCHEMA_VERSION) {
    throw new Error('The saved Fabric membership uses an unsupported storage version.')
  }
  return metadata
}

async function writeMetadata(metadata: FabricMetadataState): Promise<void> {
  await AsyncStorage.setItem(FABRIC_METADATA_KEY, JSON.stringify(metadata))
}

export async function loadFabricState(): Promise<{
  metadata: FabricMetadataState
  secrets: FabricSecretState | null
}> {
  const [metadata, secrets] = await Promise.all([readMetadata(), readSecrets()])
  if ((metadata.pending || metadata.membership) && !secrets) {
    throw new Error('The saved Fabric identity is missing its secure keys.')
  }
  if (!metadata.pending && !metadata.membership && secrets) {
    await writeSecrets(null)
    return { metadata, secrets: null }
  }
  return { metadata, secrets }
}

export async function persistPendingFabricEnrollment(
  pending: PendingFabricControllerEnrollment,
  secrets: FabricSecretState,
): Promise<void> {
  await writeSecrets(secrets)
  await writeMetadata({
    schemaVersion: FABRIC_STORAGE_SCHEMA_VERSION,
    pending,
    membership: null,
  })
}

export async function persistFabricMembership(
  membership: MobileFabricMembership,
  secrets: FabricSecretState,
): Promise<void> {
  await writeMetadata({
    schemaVersion: FABRIC_STORAGE_SCHEMA_VERSION,
    pending: null,
    membership,
  })
  // Commit the usable membership first. A crash may retain an unnecessary
  // delivery secret, but can never strand a pending record without that secret.
  await writeSecrets({ ...secrets, pendingDeliverySecret: null })
}

export async function updateStoredFabricMembership(membership: MobileFabricMembership): Promise<void> {
  await writeMetadata({
    schemaVersion: FABRIC_STORAGE_SCHEMA_VERSION,
    pending: null,
    membership,
  })
}

export async function clearStoredFabricState(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(FABRIC_METADATA_KEY),
    writeSecrets(null),
  ])
}
