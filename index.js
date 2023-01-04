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

async function getMathesarServiceContainer (name) () {
  logInfo(`Finding ${name} container...`)
  const containers = await dk.listContainers({ all: true })
  const containerDesc = containers.find(c => isMathesarServiceContainer(name, c))
  if (!containerDesc) {
    throw new Error(`Could not find ${name} container.`)
  }
  logInfo(`Found ${name} container (ID ${containerDesc.Id})`)
  const container = dk.getContainer(containerDesc.Id)
  return await container.inspect()
}

async function upgrade (name, version) {
  logInfo('Connecting to Docker API...')
  const dk = new Docker({ socketPath: '/var/run/docker.sock' })

  const prevContainer = await getMathesarServiceContainer(name)

  if (prevContainer.State.Status !== 'exited') {
    logInfo('Attempting to stop container...')
    await prevContainer.stop()
  }
  logInfo('Container is stopped.')

  logInfo('Removing container...')
  await prevContainer.remove({ v: true })
  logInfo('Container has been removed.')

  logInfo('Pulling latest Mathesar image...')
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

  logInfo('Recreating container...')
  const newContainer = await dk.createContainer({
    name: name,
    Image: `${ghcrUrl}:${version}`,
    Env: prevContainerInfo.Config.Env,
    ExposedPorts: prevContainerInfo.Config.ExposedPorts,
    Hostname: name,
    HostConfig: prevContainerInfo.HostConfig
  })
  logInfo('Starting container...')
  await newContainer.start()
  logInfo(`Container ${newContainer.id} started successfully.`)
}

async function main () {
  const fastify = require('fastify')({ logger: true })

  fastify.get('/', async (request, reply) => {
    return { ok: true }
  })

  fastify.get('/progress', async (request, reply) => {
    reply.send(getProgress())
  })

  fastify.post('/upgrade/:version?', async (request, reply) => {
    try {
      upgrade(
        request.query.container || defaultMathesarServiceContainerName,
        request.params.version || defaultMajorVersion
        )
      return { started: true }
    } catch (err) {
      logError(err)
      return { started: false, error: err.message}
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
