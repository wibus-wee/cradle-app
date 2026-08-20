const { withXcodeProject } = require('expo/config-plugins')

const PACKAGE_URL = 'https://github.com/Lakr233/MarkdownView'
const PACKAGE_NAME = 'MarkdownView'
const PACKAGE_VERSION = '4.1.0'

function withMarkdownView(config) {
  return withXcodeProject(config, (config) => {
    const project = config.modResults
    const objects = project.hash.project.objects
    const firstProject = project.getFirstProject().firstProject
    const targetUuid = firstProject.targets
      .map(target => target.value)
      .find(uuid => objects.PBXNativeTarget[uuid]?.productType === 'com.apple.product-type.application'
        || objects.PBXNativeTarget[uuid]?.productType === '"com.apple.product-type.application"')

    if (!targetUuid) {
      throw new Error('Could not find the Cradle iOS application target.')
    }

    const target = objects.PBXNativeTarget[targetUuid]
    const packageReferences = objects.XCRemoteSwiftPackageReference ??= {}
    const productDependencies = objects.XCSwiftPackageProductDependency ??= {}
    const buildFiles = objects.PBXBuildFile
    const packageReferenceUuid = findPackageReference(packageReferences)
      ?? project.generateUuid()
    const packageReferenceComment = `XCRemoteSwiftPackageReference "${PACKAGE_NAME}"`

    if (!packageReferences[packageReferenceUuid]) {
      packageReferences[packageReferenceUuid] = {
        isa: 'XCRemoteSwiftPackageReference',
        // The xcode package writer does not quote scalar values. Keep the URL
        // quoted because Xcode treats `//` as the start of a comment.
        repositoryURL: JSON.stringify(PACKAGE_URL),
        requirement: {
          kind: 'upToNextMajorVersion',
          minimumVersion: PACKAGE_VERSION,
        },
      }
      packageReferences[`${packageReferenceUuid}_comment`] = packageReferenceComment
    }

    const projectObject = objects.PBXProject[Object.keys(objects.PBXProject)
      .find(key => !key.endsWith('_comment'))]
    projectObject.packageReferences ??= []
    appendReference(projectObject.packageReferences, packageReferenceUuid, packageReferenceComment)

    const productUuid = findProductDependency(productDependencies, target)
      ?? project.generateUuid()
    const productComment = PACKAGE_NAME

    if (!productDependencies[productUuid]) {
      productDependencies[productUuid] = {
        isa: 'XCSwiftPackageProductDependency',
        package: packageReferenceUuid,
        package_comment: packageReferenceComment,
        productName: PACKAGE_NAME,
      }
      productDependencies[`${productUuid}_comment`] = productComment
    }

    target.packageProductDependencies ??= []
    appendReference(target.packageProductDependencies, productUuid, productComment)

    const frameworks = project.pbxFrameworksBuildPhaseObj(targetUuid)
    if (!frameworks) {
      throw new Error('Could not find the Cradle iOS Frameworks build phase.')
    }

    const buildFileComment = `${PACKAGE_NAME} in Frameworks`
    const buildFileUuid = findProductBuildFile(buildFiles, productUuid)
      ?? project.generateUuid()
    if (!buildFiles[buildFileUuid]) {
      buildFiles[buildFileUuid] = {
        isa: 'PBXBuildFile',
        productRef: productUuid,
        productRef_comment: productComment,
      }
      buildFiles[`${buildFileUuid}_comment`] = buildFileComment
    }
    appendReference(frameworks.files, buildFileUuid, buildFileComment)

    return config
  })
}

function appendReference(references, value, comment) {
  if (!references.some(reference => reference.value === value)) {
    references.push({ value, comment })
  }
}

function findPackageReference(section) {
  return Object.keys(section).find(key => !key.endsWith('_comment')
    && unquote(section[key].repositoryURL) === PACKAGE_URL)
}

function unquote(value) {
  return typeof value === 'string' && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value
}

function findProductDependency(section, target) {
  const dependencies = target.packageProductDependencies ?? []
  return dependencies
    .map(dependency => dependency.value)
    .find(uuid => section[uuid]?.productName === PACKAGE_NAME)
}

function findProductBuildFile(section, productUuid) {
  return Object.keys(section).find(key => !key.endsWith('_comment')
    && unquote(
      typeof section[key].productRef === 'string'
        ? section[key].productRef
        : section[key].productRef?.value,
    ) === productUuid)
}

module.exports = withMarkdownView
