import { applyDesktopDevChromiumArgs, loadDesktopDevEnv } from './dev-env'
import { installDesktopMainErrorCapture } from './observability-reporter'
import { applyDesktopPackagedObservabilityEnv } from './packaged-observability-env'

loadDesktopDevEnv()
applyDesktopPackagedObservabilityEnv()
applyDesktopDevChromiumArgs()
installDesktopMainErrorCapture()

void import('./main-app').then(({ startDesktopApp }) => startDesktopApp())
