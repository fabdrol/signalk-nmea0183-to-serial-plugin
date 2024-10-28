import { Plugin, PluginServerApp, SKVersion } from '@signalk/server-api'
import { SerialPort } from 'serialport'
import net from 'net'

/** Because the types in PluginServerApp are not complete. */
interface PluginServerAppExtended extends PluginServerApp {
  /** Log debug messages. */
  debug: (msg: string) => void
  /** Report errors in a human-oriented message. */
  error: (msg: string) => void
  /** Returns the entry for the provided path starting from the root of the full data model. */
  getPath: (path: string) => any | undefined
  /** Returns the entry for the provided path starting from vessels.self in the full data model. */
  getSelfPath: (path: string) => any | undefined
  /** Emit a delta message. */
  handleMessage: (pluginId: string, delta: any, skVersion?: SKVersion) => void
  /** Report to the server that the plugin has sent data to other hosts so it can be displayed on the Dashboard. */
  reportOutputMessages: (count?: number) => void
  /** Set the current status of the plugin that is displayed in the plugin configuration UI and the Dashboard. */
  setPluginStatus: (msg: string) => void
  /** Set the current error status of the plugin that is displayed in the plugin configuration UI and the Dashboard. */
  setPluginError: (msg: string) => void
}

interface PluginSettings {
  /** Interval to synchronize with the Cloud (milliseconds). */
  baudRate: number
  /** The serial port to use. */
  serialPort: string
}

let reportInterval: ReturnType<typeof setInterval> | null = null
let forwardedCounter = 0
let serial: SerialPort | null = null

/**
 * YachtEye Ship-to-Cloud Plugin.
 * @param {*} app The SignalK app.
 * @returns The plugin object.
 */
module.exports = (app: PluginServerAppExtended): Plugin => {
  const plugin: Plugin = {
    id: 'signalk-nmea0183-to-serial',
    name: 'NMEA0183 to Serial Port Forwarder',

    /**
     * Start the plugin.
     * @param {*} settings the configuration data entered via the Plugin Config screen.
     * @param {*} restartPlugin a function that can be called by the plugin to restart itself.
     */
    start: (settings: any, restartPlugin: any) => {
      const anyApp = app as any

      app.debug(`${plugin.id} starting...`)

      const reporter = () => {
        app.setPluginStatus(`Forwarded ${forwardedCounter} NMEA0183 messages.`)
        forwardedCounter = 0
      }

      const nmeaHandler = (sentence: string) => {
        const data = `${sentence}`.trim()
        const len = data.length

        if (data.startsWith('$') && data.charAt(len - 3) === '*') {
          forwardedCounter++
          // app.debug(`NMEA0183: ${data}`)

          if (serial) {
            serial.write(`${data}\r\n`)
          }
        }
      }

      try {
        serial = new SerialPort({
          path: settings.serialPort,
          baudRate: Number(settings.baudRate || 38400),
        })

        serial.on('open', () => {
          app.setPluginStatus(`Opened serial port ${settings.serialPort} with baudrate ${settings.baudRate}.`)
        })

        serial.on('error', (err) => {
          app.setPluginStatus(`Serial port error: ${err}.`)
        })

        anyApp.on('nmea0183', nmeaHandler)
        anyApp.on('nmea0183out', nmeaHandler)

        reportInterval = setInterval(reporter, 20000)
        app.setPluginStatus(`Started`)
      } catch (err: any) {
        app.setPluginError(`Error starting plugin: ${err?.message}`)
      }
    },

    /**
     * Stop the plugin.
     */
    stop: () => {
      if (reportInterval !== null) {
        clearInterval(reportInterval)
      }

      app.setPluginStatus(`${plugin.name} stopped.`)
    },

    schema: () => {
      return {
        type: 'object',
        required: ['baudRate', 'serialPort'],
        properties: {
          serialPort: {
            type: 'string',
            title: 'The serial port device to use (e.g. /dev/ttyUSB0).',
            default: '/dev/ttyUSB0',
          },
          baudRate: {
            type: 'number',
            title: 'The serial port baudrate to use.',
            default: 38400,
          },
        },
      }
    },
  }

  return plugin
}
