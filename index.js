var Service, Characteristic;
var wol = require('wake_on_lan');
var tcpp = require('tcp-ping');

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  homebridge.registerAccessory('homebridge-webos3', 'webos3', webos3Accessory);
}

function webos3Accessory(log, config, api) {
  this.log = log;
  this.ip = config['ip'];
  this.name = config['name'];
  this.mac = config['mac'];
  this.keyFile = config['keyFile'];
  this.volumeControl = config['volumeControl'];
  if(this.volumeControl == undefined){
    this.volumeControl = true;
  }
  this.pollingEnabled = config['pollingEnabled'];
  if(this.pollingEnabled == undefined){
    this.pollingEnabled = false;
  }
  this.alivePollingInterval = config['pollingInterval'] || 5;
  this.alivePollingInterval = this.alivePollingInterval * 1000; 
  this.externalInput = config['externalInput'];
  if(this.externalInput == undefined){
    this.externalInput = false;
  }
  this.externalSource = config['externalSource'] || 'HDMI_1';
  
  this.url = 'ws://' + this.ip + ':3000';
  this.enabledServices = [];
  this.connected = false;
  this.checkCount = 0;
  this.checkAliveInterval = null;

  this.lgtv = require('lgtv2')({
    url: this.url,
    timeout: 5000,
    reconnect: 3000,
    keyFile: this.keyFile
  });
  
  var self = this;
  
  self.lgtv.on('connect', function() {
    self.log('webOS3 connected to TV');
    self.connected = true;
    if(!self.checkAliveInterval && self.pollingEnabled) {
      self.checkAliveInterval = setInterval(self.checkTVState.bind(self, self.pollCallback.bind(self)), self.alivePollingInterval);
    }
  });
  
  self.lgtv.on('close', function() {
    self.log('webOS3 disconnected from TV');
    self.connected = false;
    //if(self.checkAliveInterval) {
    //  clearInterval(self.checkAliveInterval);
    //  self.checkAliveInterval = undefined;
    //}
  });
  
  self.lgtv.on('error', function(error) {
    self.log('webOS3 error %s', error);
    //self.connected = false;
    //setTimeout(self.lgtv.connect(this.url), 5000);
  });
  
  self.lgtv.on('prompt', function() {
    self.log('webOS3 prompt for confirmation');
    self.connected = false;
  });
  
  self.lgtv.on('connecting', function() {
    self.log('webOS3 connecting to TV');
    self.connected = false;
  });

  this.powerService = new Service.Switch(this.name + " Power", "powerService");
  this.volumeService = new Service.Lightbulb(this.name + " Volume" , "volumeService");
  this.externalInputService = new Service.Switch(this.name + " Input: " +  this.externalSource, "externalInputService");
  this.informationService = new Service.AccessoryInformation();

  this.powerService
    .getCharacteristic(Characteristic.On)
    .on('get', this.getState.bind(this))
    .on('set', this.setState.bind(this));
  
   this.volumeService
    .getCharacteristic(Characteristic.On)
    .on('get', this.getMuteState.bind(this))
    .on('set', this.setMuteState.bind(this));
  
  this.volumeService
    .addCharacteristic(new Characteristic.Brightness())
    .on('get', this.getVolume.bind(this))
    .on('set', this.setVolume.bind(this));
  
   this.externalInputService
    .getCharacteristic(Characteristic.On)
    .on('get', this.getExternalInputState.bind(this))
    .on('set', this.setExternalInputState.bind(this));
  
  this.informationService
    .setCharacteristic(Characteristic.Manufacturer, 'LG Electronics Inc.')
    .setCharacteristic(Characteristic.Model, 'webOS 3.x TV')
    .setCharacteristic(Characteristic.SerialNumber, '-')
    .setCharacteristic(Characteristic.FirmwareRevision, '0.9.0');
  
  this.enabledServices.push(this.powerService);
  if(this.volumeControl) this.enabledServices.push(this.volumeService);
  if(this.externalInput) this.enabledServices.push(this.externalInputService);
  this.enabledServices.push(this.informationService);
  
}

webos3Accessory.prototype.pollCallback = function(error, status) {
  var self = this;
  if (!status) {
    self.powerService.getCharacteristic(Characteristic.On).updateValue(status);
    self.volumeService.getCharacteristic(Characteristic.On).updateValue(status);
  } else {
    self.powerService.getCharacteristic(Characteristic.On).updateValue(status);
  }
}

webos3Accessory.prototype.checkTVState = function(callback) {
  var self = this;
  tcpp.probe(this.ip, 3000, function(err, isAlive) {
    if (!isAlive) {
      self.connected = false;
    } else {
      self.connected = true;
    }
    self.log('webOS3 TV state: %s', self.connected ? "On" : "Off");
    callback(null, self.connected);
  });
}

webos3Accessory.prototype.checkMuteState = function(callback) {
    var self = this;
    if (self.connected) {
      self.lgtv.request('ssap://audio/getStatus', function (err, res) {
        if (!res || err){
          callback(new Error('webOS3 TV mute check - error while getting current mute state'));
        }else{
          self.log('webOS3 TV muted: %s', res.mute ? "Yes" : "No");   
          callback(null, !res.mute);
        }
      });
    }else{
      callback(null, false);
    }
}

webos3Accessory.prototype.checkVolumeLevel = function(callback) {
    var self = this;
    if (self.connected) {
      self.lgtv.request('ssap://audio/getVolume', function (err, res) {
        if (!res || err){
          callback(new Error('webOS3 TV volume - error while getting current volume'));
        }else{
          self.log('webOS3 TV volume: ' + res.volume);   
          callback(null, parseInt(res.volume));
        }
      });
    }else{
      callback(null, false);
    }
}

webos3Accessory.prototype.checkExternalInput = function(callback) {
    var self = this;
    if (self.connected) {
      self.lgtv.request('ssap://com.webos.applicationManager/getForegroundAppInfo', function (err, res) {
        if (!res || err){
          callback(new Error('webOS3 TV external input - error while getting external input info'));
        }else{
          self.log('webOS3 TV current appId: %s', res.appId); 
          if(res.appId === 'com.webos.app.livetv'){
            callback(null, false);
          }else {
            callback(null, true);
          }
        }
      });
    }else{
      callback(null, false);
    }
}

webos3Accessory.prototype.checkWakeOnLan = function(callback) {
  if (this.connected) {
    this.checkCount = 0;
    callback(null, true);
  } else {
    if (this.checkCount < 3) {
      this.checkCount++;
      this.lgtv.connect(this.url);
      setTimeout(this.checkWakeOnLan.bind(this, callback), 5000);
    } else {
      this.checkCount = 0;
      callback(new Error('webOS3 wake timeout'));
    }
  }
}

webos3Accessory.prototype.getState = function(callback) {
  this.lgtv.connect(this.url);
  this.checkTVState.call(this, callback);
}

webos3Accessory.prototype.setState = function(state, callback) {
  if (state) {
    if (!this.connected) {
      var self = this;
      wol.wake(this.mac, function(error) {
        if (error) return callback(new Error('webOS3 wake on lan error'));
        this.checkCount = 0;
        setTimeout(self.checkWakeOnLan.bind(self, callback), 5000);
      })
    } else {
      callback(null, true);
    }
  } else {
    if (this.connected) {
      var self = this;
      self.lgtv.request('ssap://system/turnOff', function(err, res) {
        if (err) return callback(null, false);
        self.lgtv.disconnect();
        self.connected = false ;
        self.volumeService.getCharacteristic(Characteristic.On).updateValue(false);
        self.externalInputService.getCharacteristic(Characteristic.On).updateValue(false);
        callback(null, true);
      })
    } else {
      callback(new Error('webOS3 is not connected'))
    }
  }
}


webos3Accessory.prototype.getMuteState = function(callback) {
    setTimeout(this.checkMuteState.bind(this, callback), 50);
}

webos3Accessory.prototype.setMuteState = function(state, callback) {
    var self = this;
    if (self.connected) {
      self.lgtv.request('ssap://audio/setMute', {mute: !state});
      callback(null, state);
    }else {
      callback(new Error('webOS3 is not connected'))
    }
}


webos3Accessory.prototype.getVolume = function(callback) {
    setTimeout(this.checkVolumeLevel.bind(this, callback), 50);
}

webos3Accessory.prototype.setVolume = function(level, callback) {
    var self = this;
    if (self.connected) {
      self.lgtv.request('ssap://audio/setVolume', {volume: level});
      callback(null, level);
     }else {
      callback(new Error('webOS3 is not connected'))
    }
}

webos3Accessory.prototype.getExternalInputState = function(callback) {
  if(this.connected == false){
     callback(null, false);
  }else {
    setTimeout(this.checkExternalInput.bind(this, callback), 50);
  }
}

webos3Accessory.prototype.setExternalInputState = function(state, callback) {
    var self = this;
    if (self.connected) {
      if(state){
        self.lgtv.request('ssap://tv/switchInput', {inputId: this.externalSource});
      }else {
       self.lgtv.request('ssap://system.launcher/launch', {id: "com.webos.app.livetv"});
      }
      callback(null, state);
    }else {
      callback(new Error('webOS3 is not connected'))
    }
}


webos3Accessory.prototype.getServices = function() {
  return this.enabledServices;
}


