import { EventDetails, OnOff, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from "@scrypted/sdk";
import { Device, OnOffLightDevice } from '@project-chip/matter.js/device';

import { EventStatus, supportedTypes } from ".";

supportedTypes.set(ScryptedDeviceType.Light, {
    async discover(device: ScryptedDevice & OnOff): Promise<Device> {
        if (!device.interfaces.includes(ScryptedInterface.OnOff))
            return;

        const d = new OnOffLightDevice();

        d.addOnOffListener(on => {
            if (on)
                device.turnOn();
            else
                device.turnOff();
        });

        return d;
    },

    async sendEvent(device: ScryptedDevice & OnOff, eventDetails: EventDetails, eventData: any): Promise<EventStatus> {
        if (eventDetails.eventInterface !== ScryptedInterface.OnOff)
            return EventStatus.NotSupported;

        if (eventData)
            await device.turnOn();
        else
            await device.turnOff();

        return EventStatus.Handled;
    },
});