/*
 * Created with @iobroker/create-adapter v2.6.5
 */

import * as utils from "@iobroker/adapter-core";
import { SoundcraftUI } from "soundcraft-ui-connection";
import { Subscription } from "rxjs";

class Soundcraft extends utils.Adapter {
	private mixer: SoundcraftUI | null = null;
	private subscriptions: Subscription[] = [];
	private pollInterval: NodeJS.Timeout | null = null;

	private mixerChannels = { hw: 0, aux: 0, fx: 0, muteGroups: 6 };

	public constructor(options: Partial<utils.AdapterOptions> = {}) {
		super({ ...options, name: "soundcraft" });
		this.on("ready", this.onReady.bind(this));
		this.on("stateChange", this.onStateChange.bind(this));
		this.on("unload", this.onUnload.bind(this));
	}

	private async onReady(): Promise<void> {
		if (!this.config.mixerIP) {
			this.log.error("Mixer IP address not configured!");
			return;
		}

		this.log.info(`Connecting to Soundcraft mixer at ${this.config.mixerIP}`);

		try {
			this.mixer = new SoundcraftUI(this.config.mixerIP);

			const statusSub = this.mixer.status$.subscribe((status) => {
				const isConnected = status.type === "OPEN";
				this.log.info(`Connection status: ${status.type}`);
				this.setStateAsync("info.connection", { val: isConnected, ack: true });
			});
			this.subscriptions.push(statusSub);

			await this.mixer.connect();
			this.log.info("Successfully connected to mixer");

			await this.detectMixerCapabilities();
			await this.createObjectStructure();
			await this.subscribeMixerStates();

			this.subscribeStates("*");
		} catch (error) {
			this.log.error(`Failed to connect to mixer: ${error}`);
		}
	}

	private async detectMixerCapabilities(): Promise<void> {
		if (!this.mixer) return;

		const modelName = await this.getStateValueAsync<string>(this.mixer.deviceInfo.model$);
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

	private async createObjectStructure(): Promise<void> {
		await this.setObjectNotExistsAsync("info", {
			type: "channel",
			common: { name: "Mixer Information" },
			native: {},
		});

		await this.setObjectNotExistsAsync("info.connection", {
			type: "state",
			common: { name: "Connection status", type: "boolean", role: "indicator.connected", read: true, write: false },
			native: {},
		});

		await this.setObjectNotExistsAsync("info.model", {
			type: "state",
			common: { name: "Mixer model", type: "string", role: "info.name", read: true, write: false },
			native: {},
		});

		await this.createMasterObjects();

		for (let i = 0; i < this.mixerChannels.hw; i++) {
			await this.createChannelObjects("hw", i);
		}

		for (let i = 0; i < this.mixerChannels.aux; i++) {
			await this.createAuxObjects(i);
		}

		for (let i = 0; i < this.mixerChannels.fx; i++) {
			await this.createFxObjects(i);
		}

		for (let i = 1; i <= this.mixerChannels.muteGroups; i++) {
			await this.createMuteGroupObjects(i);
		}

		await this.createPlayerObjects();
	}

	private async createMasterObjects(): Promise<void> {
		await this.setObjectNotExistsAsync("master", {
			type: "channel",
			common: { name: "Master Channel" },
			native: {},
		});

		const states = {
			"faderLevel": { name: "Fader Level", type: "number", role: "level.volume", min: 0, max: 1, read: true, write: true },
			"pan": { name: "Pan", type: "number", role: "level.pan", min: 0, max: 1, read: true, write: true },
			"dim": { name: "Dim", type: "number", role: "switch", min: 0, max: 1, read: true, write: true },
		};

		for (const [key, config] of Object.entries(states)) {
			await this.setObjectNotExistsAsync(`master.${key}`, {
				type: "state",
				common: config as any,
				native: {},
			});
		}
	}

	private async createChannelObjects(prefix: string, channel: number): Promise<void> {
		const basePath = `${prefix}.${channel}`;

		await this.setObjectNotExistsAsync(basePath, {
			type: "channel",
			common: { name: `${prefix.toUpperCase()} Channel ${channel}` },
			native: {},
		});

		const states = {
			"faderLevel": { name: "Fader Level", type: "number", role: "level.volume", min: 0, max: 1, read: true, write: true },
			"mute": { name: "Mute", type: "number", role: "switch.mute", min: 0, max: 1, read: true, write: true },
			"pan": { name: "Pan", type: "number", role: "level.pan", min: 0, max: 1, read: true, write: true },
			"gain": { name: "Gain", type: "number", role: "level", min: 0, max: 1, read: true, write: true },
			"phantom": { name: "Phantom Power (+48V)", type: "number", role: "switch", min: 0, max: 1, read: true, write: true },
		};

		for (const [key, config] of Object.entries(states)) {
			await this.setObjectNotExistsAsync(`${basePath}.${key}`, {
				type: "state",
				common: config as any,
				native: {},
			});
		}
	}

	private async createAuxObjects(aux: number): Promise<void> {
		const basePath = `aux.${aux}`;

		await this.setObjectNotExistsAsync(basePath, {
			type: "channel",
			common: { name: `AUX ${aux}` },
			native: {},
		});

		const states = {
			"faderLevel": { name: "Fader Level", type: "number", role: "level.volume", min: 0, max: 1, read: true, write: true },
			"mute": { name: "Mute", type: "number", role: "switch.mute", min: 0, max: 1, read: true, write: true },
			"pan": { name: "Pan", type: "number", role: "level.pan", min: 0, max: 1, read: true, write: true },
		};

		for (const [key, config] of Object.entries(states)) {
			await this.setObjectNotExistsAsync(`${basePath}.${key}`, {
				type: "state",
				common: config as any,
				native: {},
			});
		}

		// Create input routing channels for this AUX bus
		for (let i = 0; i < this.mixerChannels.hw; i++) {
			await this.createAuxInputObjects(aux, i);
		}
	}

	private async createAuxInputObjects(aux: number, input: number): Promise<void> {
		const basePath = `aux.${aux}.input.${input}`;

		await this.setObjectNotExistsAsync(basePath, {
			type: "channel",
			common: { name: `AUX ${aux} Input ${input}` },
			native: {},
		});

		const states = {
			"faderLevel": { name: "Fader Level", type: "number", role: "level.volume", min: 0, max: 1, read: true, write: true },
			"mute": { name: "Mute", type: "number", role: "switch.mute", min: 0, max: 1, read: true, write: true },
			"pan": { name: "Pan", type: "number", role: "level.pan", min: 0, max: 1, read: true, write: true },
		};

		for (const [key, config] of Object.entries(states)) {
			await this.setObjectNotExistsAsync(`${basePath}.${key}`, {
				type: "state",
				common: config as any,
				native: {},
			});
		}
	}

	private async createFxObjects(fx: number): Promise<void> {
		const basePath = `fx.${fx}`;

		await this.setObjectNotExistsAsync(basePath, {
			type: "channel",
			common: { name: `FX ${fx}` },
			native: {},
		});

		const states = {
			"faderLevel": { name: "Fader Level", type: "number", role: "level.volume", min: 0, max: 1, read: true, write: true },
			"mute": { name: "Mute", type: "number", role: "switch.mute", min: 0, max: 1, read: true, write: true },
		};

		for (const [key, config] of Object.entries(states)) {
			await this.setObjectNotExistsAsync(`${basePath}.${key}`, {
				type: "state",
				common: config as any,
				native: {},
			});
		}
	}

	private async createMuteGroupObjects(group: number): Promise<void> {
		await this.setObjectNotExistsAsync(`muteGroup.${group}`, {
			type: "state",
			common: { name: `Mute Group ${group}`, type: "number", role: "switch.mute", min: 0, max: 1, read: true, write: true },
			native: {},
		});
	}

	private async createPlayerObjects(): Promise<void> {
		await this.setObjectNotExistsAsync("player", {
			type: "channel",
			common: { name: "Media Player" },
			native: {},
		});

		const states = {
			"state": { name: "Player State", type: "string", role: "media.state", read: true, write: false },
			"play": { name: "Play", type: "boolean", role: "button.play", read: true, write: true },
			"stop": { name: "Stop", type: "boolean", role: "button.stop", read: true, write: true },
			"pause": { name: "Pause", type: "boolean", role: "button.pause", read: true, write: true },
		};

		for (const [key, config] of Object.entries(states)) {
			await this.setObjectNotExistsAsync(`player.${key}`, {
				type: "state",
				common: config as any,
				native: {},
			});
		}
	}

	private async subscribeMixerStates(): Promise<void> {
		if (!this.mixer) return;

		this.subscriptions.push(
			this.mixer.master.faderLevel$.subscribe((val: number) =>
				this.setStateAsync("master.faderLevel", { val, ack: true })
			),
			this.mixer.master.pan$.subscribe((val: number) =>
				this.setStateAsync("master.pan", { val, ack: true })
			),
			this.mixer.master.dim$.subscribe((val: number) =>
				this.setStateAsync("master.dim", { val, ack: true })
			)
		);

		for (let i = 0; i < this.mixerChannels.hw; i++) {
			const ch = this.mixer.master.input(i);
			const hwCh = this.mixer.hw(i);
			const prefix = `hw.${i}`;

			this.subscriptions.push(
				ch.faderLevel$.subscribe((val: number) =>
					this.setStateAsync(`${prefix}.faderLevel`, { val, ack: true })
				),
				ch.mute$.subscribe((val: number) =>
					this.setStateAsync(`${prefix}.mute`, { val, ack: true })
				),
				ch.pan$.subscribe((val: number) =>
					this.setStateAsync(`${prefix}.pan`, { val, ack: true })
				),
				hwCh.gain$.subscribe((val: number) =>
					this.setStateAsync(`${prefix}.gain`, { val, ack: true })
				),
				hwCh.phantom$.subscribe((val: number) =>
					this.setStateAsync(`${prefix}.phantom`, { val, ack: true })
				)
			);
		}

		for (let i = 0; i < this.mixerChannels.aux; i++) {
			const auxMaster = this.mixer.master.aux(i);
			const prefix = `aux.${i}`;

			this.subscriptions.push(
				auxMaster.faderLevel$.subscribe((val: number) =>
					this.setStateAsync(`${prefix}.faderLevel`, { val, ack: true })
				),
				auxMaster.mute$.subscribe((val: number) =>
					this.setStateAsync(`${prefix}.mute`, { val, ack: true })
				),
				auxMaster.pan$.subscribe((val: number) =>
					this.setStateAsync(`${prefix}.pan`, { val, ack: true })
				)
			);

			// Subscribe to input routing for this AUX bus
			for (let j = 0; j < this.mixerChannels.hw; j++) {
				const auxBus = this.mixer.aux(i);
				const auxInput = auxBus.input(j);
				const inputPrefix = `${prefix}.input.${j}`;

				this.subscriptions.push(
					auxInput.faderLevel$.subscribe((val: number) =>
						this.setStateAsync(`${inputPrefix}.faderLevel`, { val, ack: true })
					),
					auxInput.mute$.subscribe((val: number) =>
						this.setStateAsync(`${inputPrefix}.mute`, { val, ack: true })
					),
					auxInput.pan$.subscribe((val: number) =>
						this.setStateAsync(`${inputPrefix}.pan`, { val, ack: true })
					)
				);
			}
		}

		for (let i = 0; i < this.mixerChannels.fx; i++) {
			const fxMaster = this.mixer.master.fx(i);
			const prefix = `fx.${i}`;

			this.subscriptions.push(
				fxMaster.faderLevel$.subscribe((val: number) =>
					this.setStateAsync(`${prefix}.faderLevel`, { val, ack: true })
				),
				fxMaster.mute$.subscribe((val: number) =>
					this.setStateAsync(`${prefix}.mute`, { val, ack: true })
				)
			);
		}

		for (let i = 1; i <= this.mixerChannels.muteGroups; i++) {
			const muteGroup = this.mixer.muteGroup(i as any);
			this.subscriptions.push(
				muteGroup.state$.subscribe((val: number) =>
					this.setStateAsync(`muteGroup.${i}`, { val, ack: true })
				)
			);
		}

		this.subscriptions.push(
			this.mixer.player.state$.subscribe((val) =>
				this.setStateAsync("player.state", { val: String(val), ack: true })
			)
		);
	}

	private async onStateChange(id: string, state: ioBroker.State | null | undefined): Promise<void> {
		if (!state || state.ack || !this.mixer) return;

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
				// Handle AUX input routing (e.g., aux.3.input.2.faderLevel)
				const parts = id.split(".");
				const auxIndex = parts.findIndex(p => p === "aux");
				const inputIndex = parts.findIndex(p => p === "input");
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
				const muteGroup = this.mixer.muteGroup(groupNum as any);
				if (Number(state.val) === 1) {
					muteGroup.mute();
				} else {
					muteGroup.unmute();
				}
			} else if (id.includes(".player.")) {
				switch (stateName) {
					case "play":
						if (state.val) this.mixer.player.play();
						break;
					case "stop":
						if (state.val) this.mixer.player.stop();
						break;
					case "pause":
						if (state.val) this.mixer.player.pause();
						break;
				}
			}
		} catch (error) {
			this.log.error(`Error handling state change for ${id}: ${error}`);
		}
	}

	private async getStateValueAsync<T>(observable: any): Promise<T | undefined> {
		return new Promise((resolve) => {
			let sub: any;
			let timeoutHandle: NodeJS.Timeout | null = null;
			sub = observable.subscribe((val: T) => {
				if (timeoutHandle) {
					clearTimeout(timeoutHandle);
					timeoutHandle = null;
				}
				if (sub) {
					sub.unsubscribe();
				}
				resolve(val);
			});
			timeoutHandle = setTimeout(() => {
				timeoutHandle = null;
				if (sub) {
					sub.unsubscribe();
				}
				resolve(undefined);
			}, 1000);
		});
	}

	private onUnload(callback: () => void): void {
		try {
			this.log.info("Disconnecting from mixer...");

			if (this.pollInterval) {
				clearInterval(this.pollInterval);
				this.pollInterval = null;
			}

			this.subscriptions.forEach(sub => sub.unsubscribe());
			this.subscriptions = [];

			if (this.mixer) {
				this.mixer.disconnect();
				this.mixer = null;
			}

			callback();
		} catch (e) {
			this.log.error(`Error during unload: ${e}`);
			callback();
		}
	}
}

if (require.main !== module) {
	module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new Soundcraft(options);
} else {
	(() => new Soundcraft())();
}
