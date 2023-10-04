import { EventDetails, OnOff, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from "@scrypted/sdk";
import { Device, OnOffPluginUnitDevice } from '@project-chip/matter.js/device';

import { supportedTypes } from ".";

supportedTypes.set(ScryptedDeviceType.Switch, {
    async discover(device: ScryptedDevice & OnOff): Promise<Device> {
        if (!device.interfaces.includes(ScryptedInterface.OnOff))
            return;

        const d = new OnOffPluginUnitDevice();

        d.addOnOffListener(on => {
            if (on)
                device.turnOn();
            else
                device.turnOff();
        });

        return d;
    },

    sendEvent(device: ScryptedDevice, eventDetails: EventDetails, eventData: any): Promise<void> {
        return;
    }
});