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

import got, {Response} from "got";

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
  api.registerAccessory("CEILING-FAN-REMOTE", CeilingFanRemote);
};

interface Command {
  command: number;
  targetUrl: string;
}

class CeilingFanRemote implements AccessoryPlugin {

  static COMMANDS = {
    FAN: {
      OFF: 98,
      TOGGLE: 35,
      SPEED1: 4,
      SPEED2: 32,
      SPEED3: 64,
      SPEED_DECREASE: 514,
      SPEED_INCREASE: 513,
      SPEED_MIN: 2,
      SPEED_MAX: 66
    },
    LIGHT: {
      ON: 138,
      OFF: 266,
      TOGGLE: 768,
      BRIGHTNESS1: 10,
      BRIGHTNESS2: 11,
      BRIGHTNESS3: 12,
      BRIGHTNESS4: 13,
      BRIGHTNESS5: 14,
      BRIGHTNESS6: 15,
      BRIGHTNESS7: 72,
      BRIGHTNESS8: 73,
      BRIGHTNESS_DECREASE: 265,
      BRIGHTNESS_INCREASE: 137,
      BRIGTHNESS_MIN: 9,
      BRIGHTNESS_MAX: 74
    },
    RECEIVER: {
      TOGGLE_DIMMING: 5,
      PAIR_REMOTE: 65,
    }    
  };

  private readonly log: Logging;
  private readonly name: string;
  private readonly verbose: boolean;
  private readonly rfbridge: string;
  private readonly remote: string;


  private readonly fanService: Service;
  private fanOn = false;
  private readonly fanStep = 33.33;
  private fanSpeed = 1;
  private readonly lightService: Service;
  private lightOn = false;
  private lightBrightness = 8;
  //private readonly targetControlManagementService: Service;
  private readonly informationService: Service;

  //command queue
  private pendingCommand: Boolean = false;
  private commandQueue:Array<Command> = [];


  constructor(log: Logging, config: AccessoryConfig, api: API) {
    this.log = log;
    this.name = config.name;
    this.verbose = config.verbose as boolean || false;

    if(!config.rfbridge) {
      this.log.warn(`rfbridge is a required config parameter. Running in test mode.`);
    }
    this.rfbridge = config.rfbridge || "test";

    if(!config.remote) {
      this.log.warn(`remote is a required config parameter. Running in test mode.`);
    }
    this.remote = config.remote || "test";

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
      log.info(`GET fan active (Current Value: ${this.fanOn})`);
      callback(undefined, this.fanOn);
    })
    .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      this.fanOn = value as boolean;
      log.info(`SET fan active to ${this.fanOn? "ON": "OFF"}`);

      const commands = [
        CeilingFanRemote.COMMANDS.FAN.OFF,
        CeilingFanRemote.COMMANDS.FAN.SPEED1,
        CeilingFanRemote.COMMANDS.FAN.SPEED2,
        CeilingFanRemote.COMMANDS.FAN.SPEED3
      ]

      this.sendCommand(this.fanOn ? commands[this.fanSpeed] : CeilingFanRemote.COMMANDS.FAN.OFF);

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
      log.info(`GET fan speed (Current Value: ${this.fanSpeed})`);
      callback(undefined, this.fanSpeed*this.fanStep);
    })
    .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      /*
      *   SET Rotation Speed
      */
      const newSpeed = (value as number)/this.fanStep;
      const oldSpeed = this.fanSpeed;

      if(newSpeed === 0) {
        //Speed being set to zero means we're trying to turn it off, probably via the home app.
        setTimeout(()=>{
          if(this.verbose) log.info(`Fan speed set to 0 (IE: off). Reverting speed to last good speed (${this.fanSpeed}) so that it has somewhere to go if it gets a straight "on" command`);
          this.fanService.updateCharacteristic(hap.Characteristic.RotationSpeed, this.fanSpeed*this.fanStep);
          this.fanService.updateCharacteristic(hap.Characteristic.Active, false);
        }, 100)
      }
      else {
        this.fanSpeed = newSpeed;
        log.info(`SET fan speed to ${this.fanSpeed}`);
      }

      const commands = [
        CeilingFanRemote.COMMANDS.FAN.OFF,
        CeilingFanRemote.COMMANDS.FAN.SPEED1,
        CeilingFanRemote.COMMANDS.FAN.SPEED2,
        CeilingFanRemote.COMMANDS.FAN.SPEED3
      ]

      this.sendCommand(commands[newSpeed]);
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
      log.info(`GET light on (Current Value: ${this.lightOn})`);
      callback(undefined, this.lightOn);
    })
    .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      /*
      *   SET On
      */
      this.lightOn = value as boolean;
      log.info(`SET light on to ${this.lightOn}`);
      this.sendCommand(this.lightOn ? CeilingFanRemote.COMMANDS.LIGHT.ON :  CeilingFanRemote.COMMANDS.LIGHT.OFF);
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
      log.info(`GET light brightness (Current Value: ${this.lightBrightness})`);
      callback(undefined, this.lightBrightness*12);
    })
    .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      /*
      *   SET Brightness
      */
      const newBrightness = (value as number)/12;
      const oldBrightness = this.lightBrightness;
      if(newBrightness === 0) {
        //Speed being set to zero means we're trying to turn it off, probably via the home app.
        setTimeout(()=>{
          if(this.verbose) log.info(`Light brightness set to 0 (IE: off). Reverting brightness to last good value (${this.lightBrightness}) so that it has somewhere to go if it gets a straight "on" command`);
          this.lightService.updateCharacteristic(hap.Characteristic.Brightness, this.lightBrightness);
          this.lightService.updateCharacteristic(hap.Characteristic.On, false);
        }, 100)
      }
      else {
        this.lightBrightness = newBrightness;
        log.info(`SET light brightness to ${this.lightBrightness}`);
      }

      const commands = [
        CeilingFanRemote.COMMANDS.LIGHT.OFF,
        CeilingFanRemote.COMMANDS.LIGHT.BRIGHTNESS1,
        CeilingFanRemote.COMMANDS.LIGHT.BRIGHTNESS2,
        CeilingFanRemote.COMMANDS.LIGHT.BRIGHTNESS3,
        CeilingFanRemote.COMMANDS.LIGHT.BRIGHTNESS4,
        CeilingFanRemote.COMMANDS.LIGHT.BRIGHTNESS5,
        CeilingFanRemote.COMMANDS.LIGHT.BRIGHTNESS6,
        CeilingFanRemote.COMMANDS.LIGHT.BRIGHTNESS7,
        CeilingFanRemote.COMMANDS.LIGHT.BRIGHTNESS8
      ];
      this.sendCommand(commands[newBrightness]);

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
      /*
      .setCharacteristic(Characteristic.SerialNumber, this.serialNumber || "SW01")
      .setCharacteristic(Characteristic.FirmwareRevision, packageJSON.version);
      */

    log.info("Switch finished initializing!");
  }



  /*
   * This method is optional to implement. It is called when HomeKit ask to identify the accessory.
   * Typical this only ever happens at the pairing process.
   */
  identify(): void {
    this.log("Identify!");
  }

  sendCommand(command: number = -1): void {
    /*
      Known commands

      # Fan Functions
      # Fan Power
      98 - Fan Off
      35 - Fan Toggle On/Off

      ## Absolute Speed
      4 - Fan Speed 1
      32 - Fan Speed 2
      64 - Fan Speed 3

      ## Relative speed
      514 - Fan -
      513 - Fan +
      2 - Fan Min
      66 - Fan Max

      # Light Functions
      ## Power
      138 - Light On
      266 - Light Off
      768 - Light Toggle On/Off

      ## Absolute Brightness
      10 - Light 12.5% aka level 1
      11 - Light 25.0% aka level 2
      12 - Light 37.5% aka level 3
      13 - Light 50.0% aka level 4
      14 - Light 62.5% aka level 5
      15 - Light 75.0% aka level 6
      72 - Light 87.5% aka level 7
      73 - Light 100.0% aka level 8

      ## Relative brightness
      265 - Light -
      137 - Light +
      9 - Light Min
      74 - Light Max

      # Utility Functions
      5 - Enable/Disable Light Dimming
      65 - Pair Remote
    */

    if(command === -1 || typeof command !== "number") {
      //Invalid command, do nothing.
    }
    else  {
      const room: string = `A0${this.remote.padStart(40, "0").replace(/0/g, "82").replace(/1/g, "A0")}82`;
      const rfrawCommand: string = `82${command.toString(2).padStart(10, "0").replace(/0/g, "82").replace(/1/g, "A0")}A0`;
      const rfrawInverseCommand: string = `A0${command.toString(2).padStart(10, "0").replace(/1/g, "82").replace(/0/g, "A0")}83`;
      const target: string = `http://${this.rfbridge}/cm?cmnd=rfraw%20AAB0580403018813E803106510808080808080808080808081${room}${rfrawCommand}${rfrawInverseCommand}55`;
      if(this.verbose) this.log.info(`sendCommand(${command})\n`);

      this.addCommand(command, target);
      /*
      (async () => {
          try {
              const response: Response = await got(target);
              if(this.verbose) this.log.info(`sendCommand(${command}) Response\nTarget: ${target}\nResponse ${response.body}`);
              //=> '<!doctype html> ...'
          } catch (error) {
              this.log.warn(`sendCommand(${command}) Error\nTarget: ${target}\nError: `, error);
              //=> 'Internal server error ...'
          }
      })();
      */
    }
  }

  private addCommand(command:number = -1, targetUrl:string): void {
    this.commandQueue.push({command:command, targetUrl:targetUrl});
    this.log.info(`Queued Command: {command:${command}, targetUrl:${targetUrl}}`);
    this.runNextCommand();
  }

  private runNextCommand(): void {
    if(!this.pendingCommand) {
      const nextCommand = this.commandQueue.pop();
      if(nextCommand) {
        const command:number = nextCommand.command;
        const target:string = nextCommand.targetUrl;

        if(!(this.rfbridge==="test"||this.remote==="test")) {
          this.pendingCommand = true;
          got(target)
          .then((response:Response)=>{
            if(this.verbose) this.log.info(`runCommand(${command}) \n\tTarget: ${target}\n\tResponse ${response.body}`);
          })
          .catch((error)=>{
            this.log.warn(`runCommand(${command}) Error\nTarget: ${target}\nError: `, error);
          })
          .finally(()=>{
            this.pendingCommand = false;
            this.runNextCommand();
          })
        }
        else {
          this.log.info(`TEST MODE: runCommand(${command}) \n\tTarget: ${target}`)
          //Running in test mode, no command will be sent
        }

      }
    }
    
  }

  /*
   * This method is called directly after creation of this instance.
   * It should return all services which should be added to the accessory.
   */
  getServices(): Service[] {
    return [
      this.informationService,
      this.fanService,
      this.lightService,
    ];
  }

}
