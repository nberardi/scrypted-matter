import { Device } from '@project-chip/matter.js/device';
import { ScryptedDeviceType, ScryptedDevice, EventDetails } from '@scrypted/sdk';

export enum EventStatus {
    Handled,
    Unhandled,
    NotSupported
}

export interface SupportedType {
    discover(device: ScryptedDevice): Promise<Device>;
    sendEvent(device: ScryptedDevice, eventDetails: EventDetails, eventData: any): Promise<EventStatus>;
}

export const supportedTypes = new Map<ScryptedDeviceType, SupportedType>();

import './light';
import './switch';
import './outlet';