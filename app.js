// Load .env config (silently fail if no .env present)
require('dotenv').config({ silent: true });

// Require necessary libraries
var async = require('async');
var ioLib = require('socket.io');
var http = require('http');
var path = require('path');
var express = require('express');
var mbed = require("mbed-cloud-sdk");

// CONFIG (change these)
var accessKey = process.env.ACCESS_KEY || "ChangeMe";
var port = process.env.PORT || 8080;

// Paths to resources on the devices
var blinkResourceURI = '/3201/0/5850';
var blinkPatternResourceURI = '/3201/0/5853';
var buttonResourceURI = '/3201/0/5501';

// Instantiate an mbed Cloud device API object
var connectApi = new mbed.ConnectApi({
    apiKey: accessKey
});

// Create the express app
var app = express();
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hbs');
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', function (req, res) {
  // Get all of the devices and necessary info to render the page
  connectApi.listConnectedDevices(function(error, devices) {
    var updated_devices = [];
    if (error) throw error;
    else {
      // Setup the function array
      var functionArray = devices.map(function(device) {
        return function(mapCallback) {
          connectApi.getResourceValue(device.id, blinkPatternResourceURI, function(error, value) {
            if (error) {
              mapCallback(null);
            } else {
              device.blinkPattern = value;
              updated_devices.push(device);
              mapCallback(null);
            }
          });
        };
      });
      // Fetch all blink patterns in parallel, finish when all HTTP
      // requests are complete (uses Async.js library)
      async.parallel(functionArray, function(error) {
        if (error) {
          res.send(String(error));
        } else {
          res.render('index', {
            devices: updated_devices
          });
        }
      });
    }
  });
});

// Handle unexpected server errors
app.use(function(err, req, res, next) {
  console.log(err.stack);
  res.status(err.status || 500);
  res.render('error', {
    message: err.message,
    error: err
  });
});

var sockets = [];
var server = http.Server(app);
var io = ioLib(server);

// Callback for when the button is pressed and the subscription service catches the button callback
function buttonPressed(device, payload) {
  sockets.forEach(function(socket) {
    socket.emit('presses', {
      device: device,
      value: payload
    });
  });
}

// Setup sockets for updating web UI
io.on('connection', function (socket) {
  // Add new client to array of client upon connection
  sockets.push(socket);

  socket.on('subscribe-to-presses', function (data) {
    // Subscribe to all changes of resource /3200/0/5501 (button presses)
    connectApi.addResourceSubscription(data.device, buttonResourceURI, function(error) {
      if (error) throw error;
      socket.emit('subscribed-to-presses', {
        device: data.device
      });
    }, function(payload) { 
      buttonPressed(data.device, payload); 
    });
  });

  socket.on('unsubscribe-to-presses', function(data) {
    // Unsubscribe from the resource /3200/0/5501 (button presses)
    connectApi.deleteResourceSubscription(data.device, buttonResourceURI, function(error) {
      if (error) throw error;
      socket.emit('unsubscribed-to-presses', {
        device: data.device
      });
    });
  });

  socket.on('get-presses', function(data) {
    // Read data from GET resource /3200/0/5501 (num button presses)
    connectApi.getResourceValue(data.device, buttonResourceURI, function(error, value) {
      if (error) throw error;
      socket.emit('presses', {
        device: data.device,
        value: value
      });
    });
  });

  socket.on('update-blink-pattern', function(data) {
    // Set data on PUT resource /3201/0/5853 (pattern of LED blink)
    connectApi.setResourceValue(data.device, blinkPatternResourceURI, data.blinkPattern, function(error) {
      if (error) throw error;
    });
  });

  socket.on('blink', function(data) {
    // POST to resource /3201/0/5850 (start blinking LED)
    connectApi.executeResource(data.device, blinkResourceURI, function(error) {
      if (error) throw error;
    });
  });

  socket.on('disconnect', function() {
    // Remove this socket from the array when a user closes their browser
    var index = sockets.indexOf(socket);
    if (index >= 0) {
      sockets.splice(index, 1);
    }
  })
});

// Start the app
server.listen(port, function() {
  // Set up the notification channel (pull notifications)
  connectApi.startNotifications(function(error) {
    if (error) throw error;
    else {
      console.log('mbed Cloud Quickstart listening at http://localhost:%s', port);
    }
  });
});
