const { withAppDelegate } = require('expo/config-plugins')

const SCENE_LIFECYCLE_CONFIGURATION = `
  public func application(
    _ application: UIApplication,
    configurationForConnecting connectingSceneSession: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    let configuration = UISceneConfiguration(
      name: "Default Configuration",
      sessionRole: connectingSceneSession.role
    )
    configuration.delegateClass = CradleSceneDelegate.self
    return configuration
  }
`

const SCENE_DELEGATE = `
final class CradleSceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard
      let windowScene = scene as? UIWindowScene,
      let appDelegate = UIApplication.shared.delegate as? AppDelegate,
      let factory = appDelegate.reactNativeFactory
    else {
      return
    }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: nil
    )
  }
}
`

function withIosSceneLifecycle(config) {
  return withAppDelegate(config, (config) => {
    const { modResults } = config

    if (modResults.language !== 'swift') {
      throw new Error('Cradle requires a Swift AppDelegate for iOS scene lifecycle support.')
    }

    if (modResults.contents.includes('final class CradleSceneDelegate')) {
      return config
    }

    const startupBlock = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif
`

    if (!modResults.contents.includes(startupBlock)) {
      throw new Error('Could not find the Expo React Native startup block in AppDelegate.swift.')
    }

    modResults.contents = modResults.contents
      .replace(startupBlock, '')
      .replace('  // Linking API', `${SCENE_LIFECYCLE_CONFIGURATION}\n  // Linking API`)
      .concat(`\n${SCENE_DELEGATE}`)

    return config
  })
}

module.exports = withIosSceneLifecycle
