const Docker = require('dockerode')

const defaultMathesarServiceContainerName = 'mathesar_service'
const defaultMajorVersion = '1'
const ghcrUrl = 'ghcr.io/centerofci/mathesar'

const mapOfUpgradeIdToProgress = new Map()

function getProgress(upgradeId) {
  if (upgradeId) {
    return mapOfUpgradeIdToProgress.get(upgradeId)
  } else {
    return mapOfUpgradeIdToProgress
  }
}

function logProgressItem(upgradeId, type, message) {
  progress = mapOfUpgradeIdToProgress.get(upgradeId) || []
  progressItem = new Map()
  progressItem.set('type', type)
  progressItem.set('message', message)
  progress.push(progressItem)
  mapOfUpgradeIdToProgress.set(upgradeId, progress)
}

function logUpgradeStart(upgradeId) {
  message = `Upgrade (with id ${upgradeId}) started.`
  logInfo(upgradeId, message)
}

function logUpgradeEnd(upgradeId) {
  message = `Upgrade (with id ${upgradeId}) ended.`
  logInfo(upgradeId, message)
}

function logInfo(upgradeId, message) {
  console.info(message)
  type = 'info'
  logProgressItem(upgradeId, type, message)
}

function logError(upgradeId, message) {
  console.error(message)
  type = 'error'
  logProgressItem(upgradeId, type, message)
}

function isMathesarServiceContainer (name, container) {
  hasCorrectName = container.Names.some(n => n === `/${name}` || n === name)
  hasCorrectImage = (
    container.Image.startsWith(ghcrUrl)
    || container.Image.startsWith('centerofci/mathesar')
  )
  return hasCorrectName && hasCorrectImage
}

async function getMathesarServiceContainer (upgradeId, name) () {
  logInfo(upgradeId, `Finding ${name} container...`)
  const containers = await dk.listContainers({ all: true })
  const containerDesc = containers.find(c => isMathesarServiceContainer(name, c))
  if (!containerDesc) {
    throw new Error(`Could not find ${name} container.`)
  }
  logInfo(upgradeId, `Found ${name} container (ID ${containerDesc.Id})`)
  const container = dk.getContainer(containerDesc.Id)
  return await container.inspect()
}

async function upgrade (upgradeId, name, version) {
  logInfo(upgradeId, 'Connecting to Docker API...')
  const dk = new Docker({ socketPath: '/var/run/docker.sock' })

  const prevContainer = await getMathesarServiceContainer(upgradeId, name)

  if (prevContainer.State.Status !== 'exited') {
    logInfo(upgradeId, 'Attempting to stop container...')
    await prevContainer.stop()
  }
  logInfo(upgradeId, 'Container is stopped.')

  logInfo(upgradeId, 'Removing container...')
  await prevContainer.remove({ v: true })
  logInfo(upgradeId, 'Container has been removed.')

  logInfo(upgradeId, `Pulling latest Mathesar image with major version ${version}...`)
  await new Promise((resolve, reject) => {
    dk.pull(`${ghcrUrl}:${version}`, (err, stream) => {
      if (err) { return reject(err) }
      dk.modem.followProgress(stream, (err) => {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
    })
  })

  logInfo(upgradeId, 'Recreating container...')
  const newContainer = await dk.createContainer({
    name: name,
    Image: `${ghcrUrl}:${version}`,
    Env: prevContainerInfo.Config.Env,
    ExposedPorts: prevContainerInfo.Config.ExposedPorts,
    Hostname: name,
    HostConfig: prevContainerInfo.HostConfig
  })
  logInfo(upgradeId, 'Starting container...')
  await newContainer.start()
  logInfo(upgradeId, `Container ${newContainer.id} started successfully.`)
}

// Chronologically sortable, for convenience
function getUID () {
  random_suffix = Math.floor(Math.random() * 100000)
  return Date.now() + '-' + random_suffix
}

async function main () {
  const fastify = require('fastify')({ logger: true })

  fastify.get('/', async (request, reply) => {
    return { ok: true }
  })

  fastify.get('/progress/:upgradeId?', async (request, reply) => {
    upgradeId = request.params.upgradeId
    progress = getProgress(upgradeId)
    reply.send(progress)
  })

  fastify.post('/start/:version?', async (request, reply) => {
    upgradeId = getUID()
    try {
      name = request.query.container || defaultMathesarServiceContainerName
      version = request.params.version || defaultMajorVersion
      upgrade(upgradeId, name, version)
      return { started: true, upgradeId }
    } catch (err) {
      logError(upgradeId, err.message)
      return { started: false, error: err.message, upgradeId }
    }
  })

  try {
    await fastify.listen({
      port: 80,
      host: '0.0.0.0'
    })
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}
main()
