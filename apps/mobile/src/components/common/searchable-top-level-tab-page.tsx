import { Stack } from 'expo-router'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Platform } from 'react-native'

import { TopLevelTabPage } from './top-level-tab-page'

interface TopLevelSearchState {
  onSearchQueryChange: (query: string) => void
  searchQuery: string
  showsInlineSearch: boolean
}

interface SearchableTopLevelTabPageProps {
  children: (state: TopLevelSearchState) => ReactNode
  placeholder: string
}

export function SearchableTopLevelTabPage({
  children,
  placeholder,
}: SearchableTopLevelTabPageProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const showsInlineSearch = Platform.OS === 'web'

  return (
    <TopLevelTabPage>
      {!showsInlineSearch && (
        <Stack.SearchBar
          autoCapitalize="none"
          hideWhenScrolling
          onCancelButtonPress={() => setSearchQuery('')}
          onChangeText={event => setSearchQuery(event.nativeEvent.text)}
          onClose={() => setSearchQuery('')}
          placeholder={placeholder}
          placement="stacked"
        />
      )}
      {children({ onSearchQueryChange: setSearchQuery, searchQuery, showsInlineSearch })}
    </TopLevelTabPage>
  )
}
