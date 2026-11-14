export const IPC = {
  configGet: 'config:get',
  configPatch: 'config:patch',
  sourcesAdd: 'sources:add',
  sourcesUpdate: 'sources:update',
  sourcesRemove: 'sources:remove',
  stateGet: 'state:get',
  overlayAction: 'overlay:action',
  /** renderer reports whether the pointer is over an interactive UI zone */
  overlayInteractive: 'overlay:interactive',
  /** renderer persists the chat area rect (null = full screen) */
  chatSet: 'overlay:chat',
  /** main asks the overlay to open/close the settings modal */
  panelToggle: 'overlay:panel',
  openExternal: 'app:open-external',

  authStatus: 'auth:status',
  authDeviceStart: 'auth:device-start',
  authDevicePoll: 'auth:device-poll',
  authLogout: 'auth:logout',

  modAction: 'mod:action',
  modList: 'mod:list',

  chatEvent: 'chat:event',
  chatClear: 'chat:clear',
  chatStatus: 'chat:status',
  configChanged: 'config:changed',
  authChanged: 'auth:changed'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
