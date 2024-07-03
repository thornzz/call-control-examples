# Getting Started with External Call flow Application example

This is a Full-stack Web Application for 3CX Call Control API demonstration.

## Installation

To run the Application please follow the instructions below:

1. Install [Node.js](https://nodejs.org/en).

2. Clone the entire folder to somewhere on your hard drive.

3. Open a command prompt and go to that directory

The Directory contains following folders: server (main backend), client (examples UI), calling-integration-sdk-demo-react-ts (hubSpot integration example widget), cc-component-lib(for
shared components)

4. Run packages installation

```
yarn install
```

You will be asked to download corepack, press yes to proceed

## Running

After you installed dependencies, you can proceed with testing or building the Application.

### To run basic example

Run following command from terminal:

```
yarn start
```

If you are succeeded, your browser will be opened automatically.

### To run HubSpot example

Run following command from terminal:

```
yarn start-hubspot
```

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

## HubSpot Integration Setup

HubSpot Calling SDK Integration provides live example in development local environment

> **Please note**: This is not real live ready to deploy HubSpot Application

First, look at provided by HubSpot guide [Calling Extensions SDK](https://developers.hubspot.com/docs/api/crm/extensions/calling-sdk).

1. Create HubSpot [App Developer account](https://app.hubspot.com/signup/developers)
2. Within your App Developer account create [Developer test account](https://developers.hubspot.com/docs/api/account-types#developer-test-accounts)
3. Within Developer Test Account, navigate to your records:

<ul>
    <li> Contacts: In your HubSpot account, navigate to Contacts > Contacts.</li>
    <li> Company: In your HubSpot account, navigate to Contacts > Companies.</li>
</ul>

4. Open your browser's developer console, and run the following command:
   `localStorage.setItem("LocalSettings:Calling:installDemoWidget", "local");`

5. Make sure you have run a [HubSpot example](#running)
