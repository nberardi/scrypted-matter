import sdk, { MixinProvider, ScryptedDevice, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, EventDetails, Setting, SettingValue, Settings } from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import { supportedTypes } from './types';

import { CommissioningServer, MatterServer } from "@project-chip/matter-node.js";

import { Aggregator, DeviceTypes, OnOffLightDevice, OnOffPluginUnitDevice } from "@project-chip/matter-node.js/device";
import { Format, Level, Logger } from "@project-chip/matter-node.js/log";
import { Storage, StorageBackendDisk, StorageError, StorageManager, SupportedStorageTypes, fromJson, toJson } from "@project-chip/matter-node.js/storage";
import { Time } from "@project-chip/matter-node.js/time";
import {
    commandExecutor,
    getIntParameter,
    getParameter,
    hasParameter,
    requireMinNodeVersion,
} from "@project-chip/matter-node.js/util";
import { VendorId } from "@project-chip/matter.js/datatype";

const { systemManager, deviceManager } = sdk;
const includeToken = 4;

export let DEBUG = false;

function debug(...args: any[]) {
    if (DEBUG)
        console.debug(...args);
}

class MatterPlugin extends ScryptedDeviceBase implements MixinProvider, Settings, Storage {
    storageSettings = new StorageSettings(this, {
        tokenInfo: {
            hide: true,
            json: true
        },
        syncedDevices: {
            multiple: true,
            hide: true
        },
        defaultIncluded: {
            hide: true,
            json: true
        },
        matterStorage: {
            hide: true,
            json: true
        },
        passcode: {
            title: 'Passcode',
            description: 'This is the passcode used to connect to the Matter bridge.',
            type: 'number',
            defaultValue: 20202021
        },
        discriminator: {
            title: 'Discriminator',
            description: 'TBD',
            type: 'number',
            defaultValue: 3840
        },
        vendorId: {
            title: 'Vendor Id',
            description: 'TBD',
            readonly: true,
            type: 'number',
            defaultValue: 0xfff1
        },
        productId: {
            title: 'Product Id',
            description: 'TBD',
            readonly: true,
            type: 'number',
            defaultValue: 0x8000
        },
        port: {
            title: 'Port',
            description: 'TBD',
            type: 'number',
            defaultValue: 5540
        },
        debug: {
            title: 'Debug Events',
            description: 'Log all events to the console. This will be very noisy and should not be left enabled.',
            type: 'boolean',
            onPut(oldValue: boolean, newValue: boolean) {
                DEBUG = newValue;
            }
        }
    });

    private matterServer: MatterServer | undefined;
    devices = new Map<string, ScryptedDevice>();

    constructor(nativeId?: string) {
        super(nativeId);

        DEBUG = this.storageSettings.values.debug ?? false;

        this.start();
    }

    initialize(): Promise<void> {
        return Promise.resolve();
    }
    close(): Promise<void> {
        return Promise.resolve();
    }

    buildStorageKey(contexts: string[], key: string): string {
        const contextKey = contexts.join(".");
        if (
            !key.length ||
            !contextKey.length ||
            contextKey.includes("..") ||
            contextKey.startsWith(".") ||
            contextKey.endsWith(".")
        )
            throw new StorageError("Context must not be an empty string!");
        return `${contextKey}.${key}`;
    }

    get<T extends SupportedStorageTypes>(contexts: string[], key: string): T {
        if (!contexts.length || !key.length) throw new StorageError("Context and key must not be empty strings!");
        const storageKey = this.buildStorageKey(contexts, key)
        const value = this.storageSettings.device.storage.getItem(storageKey);
        if (value === null) return undefined;
        return fromJson(value) as T;
    }
    set<T extends SupportedStorageTypes>(contexts: string[], key: string, value: T): void {
        if (!contexts.length || !key.length) throw new StorageError("Context and key must not be empty strings!");
        const storageKey = this.buildStorageKey(contexts, key)
        this.storageSettings.device.storage.setItem(storageKey, toJson(value));
    }
    delete(contexts: string[], key: string): void {
        if (!contexts.length || !key.length) throw new StorageError("Context and key must not be empty strings!");
        const storageKey = this.buildStorageKey(contexts, key)
        this.storageSettings.device.storage.removeItem(storageKey);
    }

    getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    putSetting(key: string, value: SettingValue): Promise<void> {
        return this.storageSettings.putSetting(key, value);
    }

    async start() {

        /**
         * Initialize the storage system.
         *
         * The storage manager is then also used by the Matter server, so this code block in general is required,
         * but you can choose a different storage backend as long as it implements the required API.
         */

        const storageManager = new StorageManager(this);
        await storageManager.initialize();

        /**
         * Collect all needed data
         *
         * This block makes sure to collect all needed data from cli or storage. Replace this with where ever your data
         * come from.
         *
         * Note: This example also uses the initialized storage system to store the device parameter data for convenience
         * and easy reuse. When you also do that be careful to not overlap with Matter-Server own contexts
         * (so maybe better not ;-)).
         */

        const port = this.storageSettings.values.port;
        const deviceName = "Scrypted";
        const deviceType = DeviceTypes.Aggregator.code;
        const passcode = this.storageSettings.values.passcode;
        const discriminator = this.storageSettings.values.discriminator;
        const vendorName = "Scrypted";
        const vendorId = this.storageSettings.values.vendorId;
        const productName = "Scrypted";
        const productId = this.storageSettings.values.productId;
        const uniqueId = this.nativeId;

        /**
         * Create Matter Server and CommissioningServer Node
         *
         * To allow the device to be announced, found, paired and operated we need a MatterServer instance and add a
         * commissioningServer to it and add the just created device instance to it.
         * The CommissioningServer node defines the port where the server listens for the UDP packages of the Matter protocol
         * and initializes deice specific certificates and such.
         *
         * The below logic also adds command handlers for commands of clusters that normally are handled internally
         * like testEventTrigger (General Diagnostic Cluster) that can be implemented with the logic when these commands
         * are called.
         */

        this.matterServer = new MatterServer(storageManager);

        const commissioningServer = new CommissioningServer({
            port,
            deviceName,
            deviceType,
            passcode,
            discriminator,
            basicInformation: {
                vendorName,
                vendorId: VendorId(vendorId),
                nodeLabel: productName,
                productName,
                productLabel: productName,
                productId,
                serialNumber: `node-matter-${uniqueId}`,
            },
        });

        /**
         * Create Device instance and add needed Listener
         *
         * Create an instance of the matter device class you want to use.
         * This example uses the OnOffLightDevice or OnOffPluginUnitDevice depending on the value of the type  parameter.
         * To execute the on/off scripts defined as parameters a listener for the onOff attribute is registered via the
         * device specific API.
         *
         * The below logic also adds command handlers for commands of clusters that normally are handled device internally
         * like identify that can be implemented with the logic when these commands are called.
         */

        const aggregator = new Aggregator();

        for (const id of Object.keys(systemManager.getSystemState())) {
            const device = systemManager.getDeviceById(id);
            const status = await this.tryEnableMixin(device);

            if (status === DeviceMixinStatus.Setup || status === DeviceMixinStatus.AlreadySetup) {
                const supportedType = supportedTypes.get(device.type);
                const matterDevice = await supportedType.discover(device);

                aggregator.addBridgedDevice(matterDevice, {
                    nodeLabel: device.name,
                    productName: device.info?.manufacturer ?? undefined,
                    productLabel: device.info?.model ?? undefined,
                    serialNumber: device.info?.serialNumber ?? undefined,
                    hardwareVersionString: device.info?.version ?? undefined,
                    softwareVersionString: device.info?.firmware ?? undefined,
                    productUrl: device.info?.managementUrl ?? undefined,
                    reachable: true
                });
            }
        }

        commissioningServer.addDevice(aggregator);
        this.matterServer.addCommissioningServer(commissioningServer);

        /**
         * Start the Matter Server
         *
         * After everything was plugged together we can start the server. When not delayed announcement is set for the
         * CommissioningServer node then this command also starts the announcement of the device into the network.
         */

        await this.matterServer.start();

        /**
         * Print Pairing Information
         *
         * If the device is not already commissioned (this info is stored in the storage system) then get and print the
         * pairing details. This includes the QR code that can be scanned by the Matter app to pair the device.
         */

        this.console.log(`Matter Bridge started on port ${port}.`);

        if (!commissioningServer.isCommissioned()) {
            const pairingData = commissioningServer.getPairingCode();
            const { qrCode, qrPairingCode, manualPairingCode } = pairingData;

            this.console.log(qrCode);
            this.console.log(
                `QR Code URL: https://project-chip.github.io/connectedhomeip/qrcode.html?data=${qrPairingCode}`,
            );
            this.console.log(`Manual pairing code: ${manualPairingCode}`);
        } else {
            this.console.log("Device is already commissioned. Waiting for controllers to connect ...");
        }

        systemManager.listen((async (eventSource: ScryptedDevice | undefined, eventDetails: EventDetails, eventData: any) => {
            const status = await this.tryEnableMixin(eventSource);

            if (status === DeviceMixinStatus.Setup) {
                const device = eventSource;
                const supportedType = supportedTypes.get(device.type);
                const matterDevice = await supportedType.discover(device);

                aggregator.addBridgedDevice(matterDevice, {
                    nodeLabel: device.name,
                    productName: device.info?.manufacturer ?? undefined,
                    productLabel: device.info?.model ?? undefined,
                    serialNumber: device.info?.serialNumber ?? undefined,
                    hardwareVersionString: device.info?.version ?? undefined,
                    softwareVersionString: device.info?.firmware ?? undefined,
                    productUrl: device.info?.managementUrl ?? undefined,
                    reachable: true
                });
            }

            if (status === DeviceMixinStatus.Setup || status === DeviceMixinStatus.AlreadySetup) {  

                if (!this.devices.has(eventSource.id)) {
                    this.devices.set(eventSource.id, eventSource);
                    eventSource.listen(ScryptedInterface.ObjectDetector, this.deviceListen.bind(this));
                }

                this.deviceListen(eventSource, eventDetails, eventData);
            }
        }).bind(this));
    }

    private async tryEnableMixin(device: ScryptedDevice): Promise<DeviceMixinStatus> {
        if (!device)
            return DeviceMixinStatus.NotSupported;

        const mixins = (device.mixins || []).slice();
        if (mixins.includes(this.id))
            return DeviceMixinStatus.AlreadySetup;

        const defaultIncluded = this.storageSettings.values.defaultIncluded || {};
        if (defaultIncluded[device.id] === includeToken)
            return DeviceMixinStatus.AlreadySetup;

        if (!supportedTypes.has(device.type))
            return DeviceMixinStatus.NotSupported;

        mixins.push(this.id);

        const plugins = await systemManager.getComponent('plugins');
        await plugins.setMixins(device.id, mixins);

        defaultIncluded[device.id] = includeToken;
        this.storageSettings.values.defaultIncluded = defaultIncluded;

        return DeviceMixinStatus.Setup;
    }

    async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
        const available = supportedTypes.has(type);

        if (available)
            return [];

        return;
    }

    async getMixin(device: ScryptedDevice, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }): Promise<any> {
        return device;
    }

    async releaseMixin(id: string, mixinDevice: any): Promise<void> {
        const device = systemManager.getDeviceById(id);
        const mixins = (device.mixins || []).slice();
        if (mixins.includes(this.id))
            return;

        this.log.i(`Device removed from Matter Bridge: ${device.name}.`);
        
        // TODO remove device from Matter Bridge
    }

    async deviceListen(eventSource: ScryptedDevice | undefined, eventDetails: EventDetails, eventData: any) : Promise<void> {
        if (!eventSource)
            return;

        if (!this.storageSettings.values.syncedDevices.includes(eventSource.id))
            return;

        if (eventDetails.eventInterface === ScryptedInterface.ScryptedDevice)
            return;

        const supportedType = supportedTypes.get(eventSource.type);
        if (!supportedType)
            return;

        let report = await supportedType.sendEvent(eventSource, eventDetails, eventData);

        if (!report && eventDetails.eventInterface === ScryptedInterface.Online) {
            report = {};
        }

        if (!report && eventDetails.eventInterface === ScryptedInterface.Battery) {
            report = {};
        }

        if (!report) {
            this.console.warn(`${eventDetails.eventInterface}.${eventDetails.property} not supported for device ${eventSource.type}`);
            return;
        }

        debug("event", eventDetails.eventInterface, eventDetails.property, eventSource.type);

        // TODO annouce the device change
    }
}

enum DeviceMixinStatus {
    NotSupported = 0,
    Setup = 1,
    AlreadySetup = 2
}

export default MatterPlugin;
