
const crypto = require('crypto')
const normalizeData = require('normalize-package-data')
const npa = require('npm-package-arg')
const ssri = require('ssri')

const SPDX_SCHEMA_VERSION = 'SPDX-2.3'
const SPDX_DATA_LICENSE = 'CC0-1.0'
const SPDX_IDENTIFER = 'SPDXRef-DOCUMENT'

const NO_ASSERTION = 'NOASSERTION'

const REL_DESCRIBES = 'DESCRIBES'
const REL_PREREQ = 'HAS_PREREQUISITE'
const REL_OPTIONAL = 'OPTIONAL_DEPENDENCY_OF'
const REL_DEV = 'DEV_DEPENDENCY_OF'
const REL_DEP = 'DEPENDS_ON'

const REF_CAT_PACKAGE_MANAGER = 'PACKAGE-MANAGER'
const REF_TYPE_PURL = 'purl'

const spdxOutput = ({ npm, nodes, packageType }) => {
  const rootNode = nodes.find(node => node.isRoot)
  const childNodes = nodes.filter(node => !node.isRoot)
  const rootID = rootNode.pkgid
  const uuid = crypto.randomUUID()
  const ns = `http://spdx.org/spdxdocs/${npa(rootID).escapedName}-${rootNode.version}-${uuid}`

  const relationships = nodes.map(node => {
    if (node.isLink) {
      node = node.target
    }

    return [...node.edgesOut.values()]
      // Filter out edges that are linking to nodes not in the list
      .filter(edge => nodes.find(n => n.pkgid === edge.to?.pkgid))
      .map(edge => toSpdxRelationship(node, edge))
      .filter(rel => rel)
  }).flat()

  const extraRelationships = nodes.filter(node => node.extraneous)
    .map(node => toSpdxRelationship(rootNode, { to: node, type: 'optional' }))

  relationships.push(...extraRelationships)

  const bom = {
    spdxVersion: SPDX_SCHEMA_VERSION,
    dataLicense: SPDX_DATA_LICENSE,
    SPDXID: SPDX_IDENTIFER,
    name: rootID,
    documentNamespace: ns,
    creationInfo: {
      created: new Date().toISOString(),
      creators: [
        `Tool: npm/cli-${npm.version}`,
      ],
    },
    documentDescribes: [toSpdxID(rootID)],
    packages: [toSpdxItem(rootNode, { packageType }), ...childNodes.map(toSpdxItem)],
    relationships: [
      {
        spdxElementId: SPDX_IDENTIFER,
        relatedSpdxElement: toSpdxID(rootID),
        relationshipType: REL_DESCRIBES,
      },
      ...relationships,
    ],
  }

  return bom
}

const toSpdxItem = (node, { packageType }) => {
  normalizeData(node.package)
  const id = node.pkgid

  const pkg = {
    name: node.name,
    SPDXID: toSpdxID(id),
    versionInfo: node.version,
    packageFileName: node.location,
    description: node.package?.description || undefined,
    primaryPackagePurpose: packageType ? packageType.toUpperCase() : undefined,
    downloadLocation: (node.isLink ? undefined : node.resolved) || NO_ASSERTION,
    filesAnalyzed: false,
    homepage: node.package?.homepage || NO_ASSERTION,
    licenseDeclared: node.package?.license || NO_ASSERTION,
    externalRefs: [
      {
        referenceCategory: REF_CAT_PACKAGE_MANAGER,
        referenceType: REF_TYPE_PURL,
        referenceLocator: npa.toPurl(id) + (isGitNode(node) ? `?vcs_url=${node.resolved}` : ''),
      },
    ],
  }

  if (node.integrity) {
    const integrity = ssri.parse(node.integrity, { single: true })
    pkg.checksums = [{
      algorithm: integrity.algorithm.toUpperCase(),
      checksumValue: integrity.hexDigest(),
    }]
  }
  return pkg
}

const toSpdxRelationship = (node, edge) => {
  let type
  switch (edge.type) {
    case 'peer':
      type = REL_PREREQ
      break
    case 'optional':
      type = REL_OPTIONAL
      break
    case 'dev':
      type = REL_DEV
      break
    default:
      type = REL_DEP
  }

  return {
    spdxElementId: toSpdxID(node.pkgid),
    relatedSpdxElement: toSpdxID(edge.to.pkgid),
    relationshipType: type,
  }
}

const toSpdxID = (id) => {
  let name = id
  // Strip leading @ for scoped packages
  name = name.replace(/^@/, '')

  // Replace slashes with dots
  name = name.replace(/\//g, '.')

  // Replace @ with -
  name = name.replace(/@/g, '-')

  return `SPDXRef-Package-${name}`
}

const isGitNode = (node) => {
  if (!node.resolved) {
    return
  }

  try {
    const { type } = npa(node.resolved)
    return type === 'git' || type === 'hosted'
  } catch (err) {
    /* istanbul ignore next */
    return false
  }
}

module.exports = { spdxOutput }