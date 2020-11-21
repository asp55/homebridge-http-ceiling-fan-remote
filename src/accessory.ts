import {
  AccessoryConfig,
  AccessoryPlugin,
  API,
  CharacteristicEventTypes,
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  CharacteristicValue,
  HAP,
  Logging,
  Service
} from "homebridge";

/*
 * IMPORTANT NOTICE
 *
 * One thing you need to take care of is, that you never ever ever import anything directly from the "homebridge" module (or the "hap-nodejs" module).
 * The above import block may seem like, that we do exactly that, but actually those imports are only used for types and interfaces
 * and will disappear once the code is compiled to Javascript.
 * In fact you can check that by running `npm run build` and opening the compiled Javascript file in the `dist` folder.
 * You will notice that the file does not contain a `... = require("homebridge");` statement anywhere in the code.
 *
 * The contents of the above import statement MUST ONLY be used for type annotation or accessing things like CONST ENUMS,
 * which is a special case as they get replaced by the actual value and do not remain as a reference in the compiled code.
 * Meaning normal enums are bad, const enums can be used.
 *
 * You MUST NOT import anything else which remains as a reference in the code, as this will result in
 * a `... = require("homebridge");` to be compiled into the final Javascript code.
 * This typically leads to unexpected behavior at runtime, as in many cases it won't be able to find the module
 * or will import another instance of homebridge causing collisions.
 *
 * To mitigate this the {@link API | Homebridge API} exposes the whole suite of HAP-NodeJS inside the `hap` property
 * of the api object, which can be acquired for example in the initializer function. This reference can be stored
 * like this for example and used to access all exported variables and classes from HAP-NodeJS.
 */
let hap: HAP;
/*
 * Initializer function called when the plugin is loaded.
 */
export = (api: API) => {
  hap = api.hap;

  api.registerAccessory("ExampleSwitch", ExampleSwitch);
};

class ExampleSwitch implements AccessoryPlugin {


  private readonly log: Logging;
  private readonly name: string;

  private readonly fanService: Service;
  private fanOn = false;
  private readonly fanStep = 33.33;
  private fanSpeed = this.fanStep;
  private readonly lightService: Service;
  private lightOn = false;
  private lightBrightness = 0;
  //private readonly targetControlManagementService: Service;
  private readonly informationService: Service;



  constructor(log: Logging, config: AccessoryConfig, api: API) {
    this.log = log;
    this.name = config.name;

    /*
    *   Service: Fan 
    */
    this.fanService = new hap.Service.Fanv2("Fan");

    /*
    *   Service: Fan
    *   Characteristic: Active
    */
    this.fanService.getCharacteristic(hap.Characteristic.Active)
    .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
      log.info("Get Active");
      callback(undefined, this.fanOn);
    })
    .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      this.fanOn = value as boolean;
      log.info(`Fan was set to ${this.fanOn? "ON": "OFF"}`);
      callback();
    });


    /*
    *   Service: Fan
    *   Characteristic: Rotation Speed
    */
    this.fanService.getCharacteristic(hap.Characteristic.RotationSpeed)
    .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
      /*
      *   GET Rotation Speed
      */
      log.info(`Get fan speed (Current Value: ${this.fanSpeed})`);
      callback(undefined, this.fanSpeed);
    })
    .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      /*
      *   SET Rotation Speed
      */
      const newSpeed = value as number;
      const oldSpeed = this.fanSpeed;
      if(newSpeed === 0) {
        //Speed being set to zero means we're trying to turn it off, probably via the home app.
        setTimeout(()=>{
          log.info(`Fan speed set to 0 (IE: off). Reverting speed to last good speed (${this.fanSpeed}) so that it has somewhere to go if it gets a straight "on" command`);
          this.fanService.updateCharacteristic(hap.Characteristic.RotationSpeed, this.fanSpeed);
          this.fanService.updateCharacteristic(hap.Characteristic.Active, false);
        }, 100)
      }
      else {
        this.fanSpeed = newSpeed;
        log.info(`SET fan speed to ${this.fanSpeed}`);
      }
      callback();
    })
    .setProps({
      minStep: this.fanStep,
    });


    /*
    *   Service: Light 
    */
    this.lightService = new hap.Service.Lightbulb("Light");

    /*
    *   Service: Light
    *   Characteristic: On
    */
    this.lightService.getCharacteristic(hap.Characteristic.On)
    .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
      /*
      *   GET On
      */
      log.info(`GET light on (Current Value: ${this.lightOn}`);
      callback(undefined, this.lightOn);
    })
    .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      /*
      *   SET On
      */
      this.lightOn = value as boolean;
      log.info(`SET light on to ${this.lightOn}`);
      callback();
    });

    /*
    *   Service: Light
    *   Characteristic: Brightness
    */
    this.lightService.getCharacteristic(hap.Characteristic.Brightness)
    .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
      /*
      *   GET Brightness
      */
      log.info(`GET light brightness (Current Value: ${this.lightBrightness}`);
      callback(undefined, this.lightBrightness);
    })
    .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      /*
      *   SET Brightness
      */
      const newBrightness = value as number;
      const oldBrightness = this.lightBrightness;
      if(newBrightness === 0) {
        //Speed being set to zero means we're trying to turn it off, probably via the home app.
        setTimeout(()=>{
          log.info(`Light brightness set to 0 (IE: off). Reverting brightness to last good value (${this.lightBrightness}) so that it has somewhere to go if it gets a straight "on" command`);
          this.lightService.updateCharacteristic(hap.Characteristic.Brightness, this.lightBrightness);
          this.lightService.updateCharacteristic(hap.Characteristic.On, false);
        }, 100)
      }
      else {
        this.lightBrightness = newBrightness;
        log.info(`SET light brightness to ${this.lightBrightness}`);
      }
      callback();
    })
    .setProps({
      /* Weird bug when using minStep 12.5. 
         The home app can read it just fine, but on this end it gets reported as whole numbers 0%, 25%, 50%, 75% and 100% 
         This work around of setting maxValue to 96 works, but it does make Siri's reporting back of what it does a little screwy
      */
      minStep: 12,
      maxValue: 96
    });


    /*
    *   Service: Accessory Information
    */
    this.informationService = new hap.Service.AccessoryInformation()
      .setCharacteristic(hap.Characteristic.Manufacturer, "Andrew Parnell")
      .setCharacteristic(hap.Characteristic.Model, "Ceiling fan controls");

    log.info("Switch finished initializing!");
  }

  /*
   * This method is optional to implement. It is called when HomeKit ask to identify the accessory.
   * Typical this only ever happens at the pairing process.
   */
  identify(): void {
    this.log("Identify!");
  }

  /*
   * This method is called directly after creation of this instance.
   * It should return all services which should be added to the accessory.
   */
  getServices(): Service[] {
    return [
      this.informationService,
      this.lightService,
      this.fanService,
    ];
  }

}
