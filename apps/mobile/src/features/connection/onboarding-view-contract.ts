export interface OnboardingViewProps {
  defaultUrl?: string
  error?: string | null
  isConnecting?: boolean
  onConnect: (url: string, token: string) => void
}
