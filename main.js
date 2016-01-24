/*jslint node:true, vars:true, bitwise:true, unparam:true */
/*jshint unused:true */

// load required modules
var async = require('async');                     // helps control asynchronous flow
var path = require('path');                       // utility for handling file paths
var exec = require('child_process').exec;         // runs a command in a shell and buffers the output
var spawn = require('child_process').spawn;       // launches a child process
var request = require('request');                 // http request client
var watson = require('watson-developer-cloud');   // IBM Watson services client
var five = require('johnny-five');                // robotics programming framework
var Edison = require('edison-io');                // edison IO library
var numify = require('numstr').numify;            // english number utility

// globals
var led = null;                                   // reference to led object
var working = false;                              // keeps track of if we are already working on a command

// initialize watson text-to-speech service
var textToSpeech = watson.text_to_speech({
  username: '<text-to-speech username>',
  password: '<text-to-speech password>',
  version: 'v1'
});

// initialize watson speech-to-text service
var speechToText = watson.speech_to_text({
  username: '<speech-to-text username>',
  password: '<speech-to-text password>',
  version: 'v1'
});

// accepts a string and reads it aloud
function tts (text, cb) {
  // build tts parameters
  var params = {
    text: text,
    accept: 'audio/wav'
  };
  // create gtstreamer child process to play audio
  // "fdsrc fd=0" says file to play will be on stdin
  // "wavparse" processes the file as audio/wav
  // "pulsesink" sends the audio to the default pulse audio sink device
  var gst = exec('gst-launch-1.0 fdsrc fd=0 ! wavparse ! pulsesink', function (err) {
    if (err) { return cb(err); }
    cb();
  });
  // use watson and pipe the text-to-speech results directly to gst
  textToSpeech.synthesize(params).pipe(gst.stdin);
}

// listens for audio then returns text
function stt (cb) {
  var duration = 5000;
  console.log('listening for %s ms ...', duration);
  // create an arecord child process to record audio
  var arecord = spawn('arecord', ['-D', 'hw:2,0', '-t', 'wav', '-f', 'dat']);
  // build stt params using the stdout of arecord as the audio source
  var params = {
    audio: arecord.stdout,
    content_type: 'audio/wav',
    continuous: true    // listen for audio the full 5 seconds
  };
  // use watson to get answer text
  speechToText.recognize(params, function (err, res) {
    if (err) { return cb(err); }
    var text = '';
    try {
      text = res.results[0].alternatives[0].transcript;
    } catch (e) { }
    console.log('you said: "%s"', text);
    cb(null, text.trim());
  });
  // record for duration then kill the child process
  setTimeout(function () {
    arecord.kill('SIGINT');
  }, duration);
}

// plays a local wav file
function playWav (file, cb) {
  var filePath = path.resolve(__dirname, file);
  // create gtstreamer child process to play audio
  // "filesrc location=" says use a file at the location as the src
  // "wavparse" processes the file as audio/wav
  // "volume" sets the output volume, accepts value 0 - 1
  // "pulsesink" sends the audio to the default pulse audio sink device
  exec('gst-launch-1.0 filesrc location=' + filePath + ' ! wavparse ! volume volume=0.25 ! pulsesink', function (err) {
   return cb(err);
  });
}


// initialize edison board
var board = new five.Board({
  io: new Edison(),
  repl: false           // we don't need the repl for this project
});

// when the board is ready, listen for a button press
board.on('ready', function() {
  var button = new five.Button(4);
  led = new five.Led(6);
  led.off();
  button.on('press', main);
});


// main function
function main() {
  if (working) { return; }
  working = true;
  async.waterfall([
    async.apply(playWav, '88877_DingLing.wav'),
    listen,
    search,
    speak
  ], finish);
}

// handle any errors clear led and working flag
function finish (err) {
  if (err) {
    tts('Oops, something went wrong and I was unable to complete your request.');
    console.log(err);
  }
  // stop blinking and turn off
  led.stop().off();
  working = false;
}

// listen for the audio input
function listen (cb) {
  // turn on the led
  led.on();
  stt(cb);
}

// perform a search using the duckduckgo instant answer api
function search (q, cb) {
  if (!q) {
    return cb(null, 'I\'m sorry I didn\'t hear you.');
  }
  // blick the led every 100 ms
  led.blink(100);
  // run the query through numify for better support of calculations in duckduckgo
  q = numify(q);
  console.log('searching for: %s', q);
  var requestOptions = {
    url: 'https://api.duckduckgo.com/',
    accept: 'application/json',
    qs: {
      q: q,
      format: 'json',
      no_html: 1,
      skip_disambig: 1
    }
  };
  request(requestOptions, function (err, res, body) {
    if (err) { return cb(err); }
    var result = JSON.parse(body);
    var text = 'I\'m sorry, I was unable to find any information on ' + q;   // default response
    if (result.Answer) {
      text = result.Answer;
    } else if (result.Definition) {
      text = result.Definition;
    } else if (result.AbstractText) {
      text = result.AbstractText;
    }
    cb(null, text);
  });
}

// read the search results
function speak (text, cb) {
  // stop blinking and turn off
  led.stop().off();
  if (!text) { return cb(); }
  tts(text, cb);
}

