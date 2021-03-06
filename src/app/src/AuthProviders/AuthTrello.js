import {ipcMain} from 'electron'
import { WB_AUTH_TRELLO, WB_AUTH_TRELLO_COMPLETE, WB_AUTH_TRELLO_ERROR } from 'shared/ipcEvents'
import { URL } from 'url'
import querystring from 'querystring'
import AuthWindow from 'Windows/AuthWindow'

const TOKEN_REGEX = new RegExp(/[&#]?token=([0-9a-f]{64})/)

class AuthTrello {
  /* ****************************************************************************/
  // Lifecycle
  /* ****************************************************************************/

  constructor () {
    ipcMain.on(WB_AUTH_TRELLO, (evt, body) => {
      this.handleAuthTrello(evt, body)
    })
  }

  /* ****************************************************************************/
  // Authentication
  /* ****************************************************************************/

  /**
  * Generates the authentication url for our secrets, scopes and access type
  * @param credentials: the credentials to use
  * @param appKey: the key to authenticate against
  * @return the url that can be used to authenticate with goog
  */
  generateAuthenticationURL (credentials, appKey) {
    return 'https://trello.com/1/authorize?' + querystring.stringify({
      return_url: credentials.TRELLO_AUTH_RETURN_URL,
      callback_method: 'fragment',
      scope: 'read,account',
      expiration: 'never',
      name: credentials.TRELLO_AUTH_APP_NAME,
      key: appKey
    })
  }

  /**
  * Gets the authorization code by prompting the user to sign in
  * @param credentials: the credentials to use
  * @param partitionId: the id of the partition
  * @return promise
  */
  promptUserToGetAuthorizationCode (credentials, partitionId) {
    return new Promise((resolve, reject) => {
      const waveboxOauthWin = new AuthWindow()
      waveboxOauthWin.create('https://trello.com/login', {
        useContentSize: true,
        center: true,
        show: true,
        resizable: false,
        standardWindow: true,
        autoHideMenuBar: true,
        title: 'Trello',
        height: 750,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          nativeWindowOpen: true,
          sharedSiteInstances: true,
          partition: partitionId.indexOf('persist:') === 0 ? partitionId : 'persist:' + partitionId
        }
      })
      const oauthWin = waveboxOauthWin.window
      let appKey
      let userClose = true

      oauthWin.on('closed', () => {
        if (userClose) {
          reject(new Error('User closed the window'))
        }
      })

      // STEP 2: Get app key
      oauthWin.webContents.on('did-navigate', (evt, nextURL) => {
        const { hostname, pathname } = new URL(nextURL)
        if (hostname === 'trello.com' && pathname === '/') {
          const captureFn = (evt) => {
            if (oauthWin.webContents.getURL() === 'https://trello.com/app-key') {
              oauthWin.webContents.executeJavaScript('document.getElementById("key").value', (key) => {
                appKey = key
                oauthWin.loadURL(this.generateAuthenticationURL(credentials, key))
              })
              oauthWin.webContents.removeListener('dom-ready', captureFn)
            }
          }
          oauthWin.webContents.on('dom-ready', captureFn)
          oauthWin.loadURL('https://trello.com/app-key')
          oauthWin.hide()
        }
      })

      // STEP 3: Authentication complete
      oauthWin.webContents.on('did-navigate', (evt, nextURL) => {
        const { hostname, pathname } = new URL(nextURL)
        if (hostname === 'trello.com' && pathname.indexOf('/1/authorize') === 0) {
          // The UI takes some time to update and it's janky
          setTimeout(() => {
            oauthWin.show()
          }, 250)
        }
      })
      oauthWin.webContents.on('will-navigate', (evt, nextUrl) => {
        if (nextUrl.indexOf(credentials.TRELLO_AUTH_RETURN_URL) === 0) {
          evt.preventDefault()
          userClose = false
          oauthWin.close()
          const token = TOKEN_REGEX.exec(nextUrl)
          if (token && token.length === 2) {
            resolve({ appKey: appKey, token: token[1] })
          } else {
            reject(new Error('Failed to aquire token `' + nextUrl + '`'))
          }
        }
      })
    })
  }

  /* ****************************************************************************/
  // Request Handlers
  /* ****************************************************************************/

  /**
  * Handles the oauth request
  * @param evt: the incoming event
  * @param body: the body sent to us
  */
  handleAuthTrello (evt, body) {
    Promise.resolve()
      .then(() => this.promptUserToGetAuthorizationCode(body.credentials, body.id))
      .then(({ appKey, token }) => {
        evt.sender.send(WB_AUTH_TRELLO_COMPLETE, {
          id: body.id,
          authMode: body.authMode,
          provisional: body.provisional,
          appKey: appKey,
          token: token
        })
      }, (err) => {
        evt.sender.send(WB_AUTH_TRELLO_ERROR, {
          id: body.id,
          authMode: body.authMode,
          provisional: body.provisional,
          error: err,
          errorString: (err || {}).toString ? (err || {}).toString() : undefined,
          errorMessage: (err || {}).message ? (err || {}).message : undefined,
          errorStack: (err || {}).stack ? (err || {}).stack : undefined
        })
      })
  }
}

export default AuthTrello
