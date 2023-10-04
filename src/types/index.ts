import { Device } from '@project-chip/matter.js/device';
import { ScryptedDeviceType, ScryptedDevice, EventDetails } from '@scrypted/sdk';

export interface SupportedType {
    discover(device: ScryptedDevice): Promise<Device>;
    sendEvent(device: ScryptedDevice, eventDetails: EventDetails, eventData: any): Promise<void>;
}

export const supportedTypes = new Map<ScryptedDeviceType, SupportedType>();
