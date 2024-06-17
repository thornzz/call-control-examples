# Getting Started with External Call flow Application example

This is a Full-stack Web Application for 3CX Call Control API demonstration.

## Installation

To run the Application please follow the instructions below:

1. Install [Node.js](https://nodejs.org/en).

2. Clone the entire folder to somewhere on your hard drive.

3. Open a command prompt and go to that directory

The Directory contains two separate folders: client and server. For both of them you need
to install dependencies. So, you need to go to each folder and run following command:

```
npm install
```

## Running

After you installed dependencies, you can proceed with testing or building the Application.

To Run Application in Development environment you need to run both client and server application:

1. To run server:

Got to the `server` folder and run following command:

```
npm start
```

If you are succeeded, you will see `SERVER STARTED` message in the console

2. To run Client:

Open a separate command prompt instance and go to the `client` folder, then run the following command again:

```
npm start
```

If you are succeeded, your browser will be opened automatically.

## Binding IVR external application to dummy route point on PBX

Create new processing script assigned to "dial code" and specify following implementation (script code)

```
using CallFlow;
namespace dummy
{
    public class dummy:ScriptBase<dummy>
    {
        public override void Start()
        {
        }
    }
}
```

This script will answer the call and do nothing.
Use Advanced/Parameters to assign the following properties:
APPID (string)
APPSECRET (string)
If application is running on the PBX host (local host version)
set APPHOOK to http://localhost:8080/api/webhook/ivr
if application is running in PBX local network (not straight on the PBX host)
set APPHOOK to http://<ip_of_application_server_host>:8080/api/webhook/ivr

Then in the example UI (browser will be opened as specified above) click on "Custom IVR"
enter PBX web address APPID and APPSECTRET in corresponding fields.
Press Connect button
If all is done correctly, configuration of external application configuration page will appear.
Follow the instruction on the screen to configure IVR.
It contains:
prompt file and destinations for different DTMF digits.
Press Update config
Make call to RoutePoint number.
RoutePoint will answer and you should hear the prompt.
Press DTMF button, call should be redirected to the specified destination.
If destination does not answer, prompt will be repeated, and you can retry with other (or same) DTMF

You can enter comma separated list of number at the bottom of the page and then press Start Dialing.
The IVR application will make sequence of the calls to each number specified in the list (one by one)
