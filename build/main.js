"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var utils = __toESM(require("@iobroker/adapter-core"));
var import_soundcraft_ui_connection = require("soundcraft-ui-connection");
class Soundcraft extends utils.Adapter {
  mixer = null;
  subscriptions = [];
  mixerChannels = { hw: 0, aux: 0, fx: 0, muteGroups: 6 };
  constructor(options = {}) {
    super({ ...options, name: "soundcraft" });
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }
  async onReady() {
    if (!this.config.mixerIP) {
      this.log.error("Mixer IP address not configured!");
      return;
    }
    this.log.info(`Connecting to Soundcraft mixer at ${this.config.mixerIP}`);
    try {
      this.mixer = new import_soundcraft_ui_connection.SoundcraftUI(this.config.mixerIP);
      const statusSub = this.mixer.status$.subscribe((status) => {
        const isConnected = status.type === "OPEN";
        this.log.info(`Connection status: ${status.type}`);
        void this.setStateAsync("info.connection", { val: isConnected, ack: true });
      });
      this.subscriptions.push(statusSub);
      await this.mixer.connect();
      this.log.info("Successfully connected to mixer");
      await this.detectMixerCapabilities();
      await this.createObjectStructure();
      this.subscribeMixerStates();
      this.subscribeStates("*");
    } catch (error) {
      this.log.error(`Failed to connect to mixer: ${String(error)}`);
    }
  }
  async detectMixerCapabilities() {
    if (!this.mixer) {
      return;
    }
    const modelName = await this.getStateValueAsync(this.mixer.deviceInfo.model$);
    this.log.info(`Detected mixer model: ${modelName || "Unknown"}`);
    const model = String(modelName || "");
    if (model.includes("Ui24")) {
      this.mixerChannels = { hw: 24, aux: 10, fx: 4, muteGroups: 6 };
    } else if (model.includes("Ui16")) {
      this.mixerChannels = { hw: 16, aux: 4, fx: 2, muteGroups: 6 };
    } else if (model.includes("Ui12")) {
      this.mixerChannels = { hw: 12, aux: 2, fx: 2, muteGroups: 6 };
    } else {
      this.mixerChannels = { hw: 24, aux: 10, fx: 4, muteGroups: 6 };
    }
    await this.setStateAsync("info.model", { val: String(modelName || "Unknown"), ack: true });
  }
  async createObjectStructure() {
    await this.setObjectNotExistsAsync("info", {
      type: "channel",
      common: { name: "Mixer Information" },
      native: {}
    });
    await this.setObjectNotExistsAsync("info.connection", {
      type: "state",
      common: {
        name: "Connection status",
        type: "boolean",
        role: "indicator.connected",
        read: true,
        write: false
      },
      native: {}
    });
    await this.setObjectNotExistsAsync("info.model", {
      type: "state",
      common: { name: "Mixer model", type: "string", role: "info.name", read: true, write: false },
      native: {}
    });
    await this.createMasterObjects();
    await this.setObjectNotExistsAsync("hw", {
      type: "device",
      common: { name: "Hardware Inputs" },
      native: {}
    });
    for (let i = 0; i < this.mixerChannels.hw; i++) {
      await this.createChannelObjects("hw", i);
    }
    await this.setObjectNotExistsAsync("aux", {
      type: "device",
      common: { name: "AUX Buses" },
      native: {}
    });
    for (let i = 0; i < this.mixerChannels.aux; i++) {
      await this.createAuxObjects(i);
    }
    await this.setObjectNotExistsAsync("fx", {
      type: "device",
      common: { name: "FX Buses" },
      native: {}
    });
    for (let i = 0; i < this.mixerChannels.fx; i++) {
      await this.createFxObjects(i);
    }
    await this.setObjectNotExistsAsync("muteGroup", {
      type: "device",
      common: { name: "Mute Groups" },
      native: {}
    });
    for (let i = 1; i <= this.mixerChannels.muteGroups; i++) {
      await this.createMuteGroupObjects(i);
    }
    await this.createPlayerObjects();
  }
  async createMasterObjects() {
    await this.setObjectNotExistsAsync("master", {
      type: "channel",
      common: { name: "Master Channel" },
      native: {}
    });
    const states = {
      faderLevel: {
        name: "Fader Level",
        type: "number",
        role: "level.volume",
        min: 0,
        max: 1,
        read: true,
        write: true
      },
      pan: { name: "Pan", type: "number", role: "level", min: 0, max: 1, read: true, write: true },
      dim: { name: "Dim", type: "number", role: "level.dimmer", min: 0, max: 1, read: true, write: true }
    };
    for (const [key, config] of Object.entries(states)) {
      await this.setObjectNotExistsAsync(`master.${key}`, {
        type: "state",
        common: config,
        native: {}
      });
    }
  }
  async createChannelObjects(prefix, channel) {
    const basePath = `${prefix}.${channel}`;
    await this.setObjectNotExistsAsync(basePath, {
      type: "channel",
      common: { name: `${prefix.toUpperCase()} Channel ${channel}` },
      native: {}
    });
    const states = {
      faderLevel: {
        name: "Fader Level",
        type: "number",
        role: "level.volume",
        min: 0,
        max: 1,
        read: true,
        write: true
      },
      mute: { name: "Mute", type: "boolean", role: "switch", read: true, write: true },
      pan: { name: "Pan", type: "number", role: "level", min: 0, max: 1, read: true, write: true },
      gain: { name: "Gain", type: "number", role: "level", min: 0, max: 1, read: true, write: true },
      phantom: { name: "Phantom Power (+48V)", type: "boolean", role: "switch", read: true, write: true }
    };
    for (const [key, config] of Object.entries(states)) {
      await this.setObjectNotExistsAsync(`${basePath}.${key}`, {
        type: "state",
        common: config,
        native: {}
      });
    }
  }
  async createAuxObjects(aux) {
    const basePath = `aux.${aux}`;
    await this.setObjectNotExistsAsync(basePath, {
      type: "channel",
      common: { name: `AUX ${aux}` },
      native: {}
    });
    const states = {
      faderLevel: {
        name: "Fader Level",
        type: "number",
        role: "level.volume",
        min: 0,
        max: 1,
        read: true,
        write: true
      },
      mute: { name: "Mute", type: "boolean", role: "switch", read: true, write: true },
      pan: { name: "Pan", type: "number", role: "level", min: 0, max: 1, read: true, write: true }
    };
    for (const [key, config] of Object.entries(states)) {
      await this.setObjectNotExistsAsync(`${basePath}.${key}`, {
        type: "state",
        common: config,
        native: {}
      });
    }
    await this.setObjectNotExistsAsync(`${basePath}.input`, {
      type: "channel",
      common: { name: `AUX ${aux} Inputs` },
      native: {}
    });
    for (let i = 0; i < this.mixerChannels.hw; i++) {
      await this.createAuxInputObjects(aux, i);
    }
  }
  async createAuxInputObjects(aux, input) {
    const basePath = `aux.${aux}.input.${input}`;
    await this.setObjectNotExistsAsync(basePath, {
      type: "channel",
      common: { name: `AUX ${aux} Input ${input}` },
      native: {}
    });
    const states = {
      faderLevel: {
        name: "Fader Level",
        type: "number",
        role: "level.volume",
        min: 0,
        max: 1,
        read: true,
        write: true
      },
      mute: { name: "Mute", type: "boolean", role: "switch", read: true, write: true },
      pan: { name: "Pan", type: "number", role: "level", min: 0, max: 1, read: true, write: true }
    };
    for (const [key, config] of Object.entries(states)) {
      await this.setObjectNotExistsAsync(`${basePath}.${key}`, {
        type: "state",
        common: config,
        native: {}
      });
    }
  }
  async createFxObjects(fx) {
    const basePath = `fx.${fx}`;
    await this.setObjectNotExistsAsync(basePath, {
      type: "channel",
      common: { name: `FX ${fx}` },
      native: {}
    });
    const states = {
      faderLevel: {
        name: "Fader Level",
        type: "number",
        role: "level.volume",
        min: 0,
        max: 1,
        read: true,
        write: true
      },
      mute: { name: "Mute", type: "boolean", role: "switch", read: true, write: true }
    };
    for (const [key, config] of Object.entries(states)) {
      await this.setObjectNotExistsAsync(`${basePath}.${key}`, {
        type: "state",
        common: config,
        native: {}
      });
    }
  }
  async createMuteGroupObjects(group) {
    await this.setObjectNotExistsAsync(`muteGroup.${group}`, {
      type: "state",
      common: { name: `Mute Group ${group}`, type: "boolean", role: "media.mute.group", read: true, write: true },
      native: {}
    });
  }
  async createPlayerObjects() {
    await this.setObjectNotExistsAsync("player", {
      type: "channel",
      common: { name: "Media Player" },
      native: {}
    });
    const states = {
      state: { name: "Player State", type: "string", role: "media.state", read: true, write: false },
      play: { name: "Play", type: "boolean", role: "button.play", read: false, write: true },
      stop: { name: "Stop", type: "boolean", role: "button.stop", read: false, write: true },
      pause: { name: "Pause", type: "boolean", role: "button.pause", read: false, write: true }
    };
    for (const [key, config] of Object.entries(states)) {
      await this.setObjectNotExistsAsync(`player.${key}`, {
        type: "state",
        common: config,
        native: {}
      });
    }
  }
  subscribeMixerStates() {
    if (!this.mixer) {
      return;
    }
    this.subscriptions.push(
      this.mixer.master.faderLevel$.subscribe(
        (val) => void this.setStateAsync("master.faderLevel", { val, ack: true })
      ),
      this.mixer.master.pan$.subscribe(
        (val) => void this.setStateAsync("master.pan", { val, ack: true })
      ),
      this.mixer.master.dim$.subscribe(
        (val) => void this.setStateAsync("master.dim", { val, ack: true })
      )
    );
    for (let i = 0; i < this.mixerChannels.hw; i++) {
      const ch = this.mixer.master.input(i);
      const hwCh = this.mixer.hw(i);
      const prefix = `hw.${i}`;
      this.subscriptions.push(
        ch.faderLevel$.subscribe(
          (val) => void this.setStateAsync(`${prefix}.faderLevel`, { val, ack: true })
        ),
        ch.mute$.subscribe(
          (val) => void this.setStateAsync(`${prefix}.mute`, { val: Boolean(val), ack: true })
        ),
        ch.pan$.subscribe((val) => void this.setStateAsync(`${prefix}.pan`, { val, ack: true })),
        hwCh.gain$.subscribe((val) => void this.setStateAsync(`${prefix}.gain`, { val, ack: true })),
        hwCh.phantom$.subscribe(
          (val) => void this.setStateAsync(`${prefix}.phantom`, { val: Boolean(val), ack: true })
        )
      );
    }
    for (let i = 0; i < this.mixerChannels.aux; i++) {
      const auxMaster = this.mixer.master.aux(i);
      const prefix = `aux.${i}`;
      this.subscriptions.push(
        auxMaster.faderLevel$.subscribe(
          (val) => void this.setStateAsync(`${prefix}.faderLevel`, { val, ack: true })
        ),
        auxMaster.mute$.subscribe(
          (val) => void this.setStateAsync(`${prefix}.mute`, { val: Boolean(val), ack: true })
        ),
        auxMaster.pan$.subscribe((val) => void this.setStateAsync(`${prefix}.pan`, { val, ack: true }))
      );
      for (let j = 0; j < this.mixerChannels.hw; j++) {
        const auxBus = this.mixer.aux(i);
        const auxInput = auxBus.input(j);
        const inputPrefix = `${prefix}.input.${j}`;
        this.subscriptions.push(
          auxInput.faderLevel$.subscribe(
            (val) => void this.setStateAsync(`${inputPrefix}.faderLevel`, { val, ack: true })
          ),
          auxInput.mute$.subscribe(
            (val) => void this.setStateAsync(`${inputPrefix}.mute`, { val: Boolean(val), ack: true })
          ),
          auxInput.pan$.subscribe(
            (val) => void this.setStateAsync(`${inputPrefix}.pan`, { val, ack: true })
          )
        );
      }
    }
    for (let i = 0; i < this.mixerChannels.fx; i++) {
      const fxMaster = this.mixer.master.fx(i);
      const prefix = `fx.${i}`;
      this.subscriptions.push(
        fxMaster.faderLevel$.subscribe(
          (val) => void this.setStateAsync(`${prefix}.faderLevel`, { val, ack: true })
        ),
        fxMaster.mute$.subscribe(
          (val) => void this.setStateAsync(`${prefix}.mute`, { val: Boolean(val), ack: true })
        )
      );
    }
    for (let i = 1; i <= this.mixerChannels.muteGroups; i++) {
      const muteGroup = this.mixer.muteGroup(i);
      this.subscriptions.push(
        muteGroup.state$.subscribe(
          (val) => void this.setStateAsync(`muteGroup.${i}`, { val: Boolean(val), ack: true })
        )
      );
    }
    this.subscriptions.push(
      this.mixer.player.state$.subscribe(
        (val) => void this.setStateAsync("player.state", { val: String(val), ack: true })
      )
    );
  }
  onStateChange(id, state) {
    if (!state || state.ack || !this.mixer) {
      return;
    }
    const idParts = id.split(".");
    const deviceId = idParts[idParts.length - 2];
    const stateName = idParts[idParts.length - 1];
    try {
      if (id.includes(".master.")) {
        switch (stateName) {
          case "faderLevel":
            this.mixer.master.setFaderLevel(Number(state.val));
            break;
          case "pan":
            this.mixer.master.setPan(Number(state.val));
            break;
          case "dim":
            this.mixer.master.setDim(Number(state.val));
            break;
        }
      } else if (id.includes(".hw.")) {
        const channelNum = parseInt(deviceId);
        switch (stateName) {
          case "faderLevel":
            this.mixer.master.input(channelNum).setFaderLevel(Number(state.val));
            break;
          case "mute":
            this.mixer.master.input(channelNum).setMute(Number(state.val));
            break;
          case "pan":
            this.mixer.master.input(channelNum).setPan(Number(state.val));
            break;
          case "gain":
            this.mixer.hw(channelNum).setGain(Number(state.val));
            break;
          case "phantom":
            this.mixer.hw(channelNum).setPhantom(Number(state.val));
            break;
        }
      } else if (id.includes(".aux.") && id.includes(".input.")) {
        const parts = id.split(".");
        const auxIndex = parts.findIndex((p) => p === "aux");
        const inputIndex = parts.findIndex((p) => p === "input");
        const auxNum = parseInt(parts[auxIndex + 1]);
        const inputNum = parseInt(parts[inputIndex + 1]);
        const auxBus = this.mixer.aux(auxNum);
        const auxInput = auxBus.input(inputNum);
        switch (stateName) {
          case "faderLevel":
            auxInput.setFaderLevel(Number(state.val));
            break;
          case "mute":
            auxInput.setMute(Number(state.val));
            break;
          case "pan":
            auxInput.setPan(Number(state.val));
            break;
        }
      } else if (id.includes(".aux.")) {
        const auxNum = parseInt(deviceId);
        const auxMaster = this.mixer.master.aux(auxNum);
        switch (stateName) {
          case "faderLevel":
            auxMaster.setFaderLevel(Number(state.val));
            break;
          case "mute":
            auxMaster.setMute(Number(state.val));
            break;
          case "pan":
            auxMaster.setPan(Number(state.val));
            break;
        }
      } else if (id.includes(".fx.")) {
        const fxNum = parseInt(deviceId);
        const fxMaster = this.mixer.master.fx(fxNum);
        switch (stateName) {
          case "faderLevel":
            fxMaster.setFaderLevel(Number(state.val));
            break;
          case "mute":
            fxMaster.setMute(Number(state.val));
            break;
        }
      } else if (id.includes(".muteGroup.")) {
        const groupNum = parseInt(idParts[idParts.length - 1]);
        const muteGroup = this.mixer.muteGroup(groupNum);
        if (Number(state.val) === 1) {
          muteGroup.mute();
        } else {
          muteGroup.unmute();
        }
      } else if (id.includes(".player.")) {
        switch (stateName) {
          case "play":
            if (state.val) {
              this.mixer.player.play();
            }
            break;
          case "stop":
            if (state.val) {
              this.mixer.player.stop();
            }
            break;
          case "pause":
            if (state.val) {
              this.mixer.player.pause();
            }
            break;
        }
      }
    } catch (error) {
      this.log.error(`Error handling state change for ${id}: ${String(error)}`);
    }
  }
  async getStateValueAsync(observable) {
    return new Promise((resolve) => {
      let timeoutHandle = void 0;
      let resolved = false;
      const sub = observable.subscribe((val) => {
        if (!resolved) {
          resolved = true;
          if (timeoutHandle) {
            this.clearTimeout(timeoutHandle);
            timeoutHandle = void 0;
          }
          sub.unsubscribe();
          resolve(val);
        }
      });
      timeoutHandle = this.setTimeout(() => {
        if (!resolved) {
          resolved = true;
          timeoutHandle = void 0;
          sub.unsubscribe();
          resolve(void 0);
        }
      }, 1e3);
    });
  }
  onUnload(callback) {
    try {
      this.log.info("Disconnecting from mixer...");
      this.subscriptions.forEach((sub) => sub.unsubscribe());
      this.subscriptions = [];
      if (this.mixer) {
        void this.mixer.disconnect();
        this.mixer = null;
      }
      callback();
    } catch (e) {
      this.log.error(`Error during unload: ${String(e)}`);
      callback();
    }
  }
}
if (require.main !== module) {
  module.exports = (options) => new Soundcraft(options);
} else {
  (() => new Soundcraft())();
}
//# sourceMappingURL=main.js.map
