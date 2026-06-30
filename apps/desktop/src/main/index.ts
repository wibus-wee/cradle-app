import { applyDesktopDevChromiumArgs, loadDesktopDevEnv } from './dev-env'
import { installDesktopMainErrorCapture } from './observability-reporter'

loadDesktopDevEnv()
applyDesktopDevChromiumArgs()
installDesktopMainErrorCapture()

void import('./main-app').then(({ startDesktopApp }) => startDesktopApp())
