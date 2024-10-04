# Getting Started with Configuring External Call flow Application

This is a Full-stack Web Application for 3CX Call Control API demonstration.

## Configuration steps from PBX Side

From the Admin Console in the 3CX Webclient, go to Integrations > API:
 1. Press the Add button to create a new client application.
 2. Specify the ClientID (DN for accessing the route point, which is also needed for authorization).
 3. If using the Call Control scope, check the Call Control Access Enabled checkbox.
 4. (Optional) Specify DID numbers for the Route Point.
 5. (Optional) Specify additional extensions you want to monitor using the API.
 6. After successfully creating a new API instance, you will receive an API key for your third-party applications. This key will be shown only once, so be sure to save it for future use.

- [x] **That's it! You've successfully completed the PBX configuration.**

> [!IMPORTANT]
> You must have a 3CX Enterprise license and CFD to use 3CX Call Control.

## External Web Application Installation and Configuration

### Installation

To run the Application please follow the instructions below:

1. Install [Node.js](https://nodejs.org/en).

2. Clone the entire folder to somewhere on your hard drive.

3. Open a command prompt and go to that directory

The Directory contains following folders: server (main backend), client (examples UI), calling-integration-sdk-demo-react-ts (HubSpot integration example widget), cc-component-lib(for
shared components)

4. Run packages installation

```
yarn install
```

- [x] **Done!** After you installed dependencies, you can proceed with running the Application.

### Running Basic Example

Basic example contains 3 different approaches of PBX Call Control API usage, for each of them you need to have [Configured from PBX side RoutePoint](#configuration-steps-from-pbx-side)

- `Custom IVR implementation`: This application implements IVR functionality. After you have connected your APP,
  you can specify configuration for your IVR. Prompt file will be streamed to each handled by IVR connection,
  you also may specify DTMF string routes for redirection purposes. Moreover, you are able to perform
  outgoing calls from Custom IVR. You may specify comma-separated phone numbers and run dialing campaign.
- `Outbound Campaign implementation`: This application represents simple Outbound Campaign, you may specify comma-separated phone numbers and run dialing campaign
- `Dialer implementation`: This application represents simple Dialer, you may use it like physical phone device. You also free to choose which device from list you will select for call handling

To Start the Application, please run following command from terminal:

```
yarn start
```

> [!NOTE]
> run Application Server at http://localhost:8080. The Application Server Base Path is configurable depending on the `.env` configuration file, which you can find inside the root folder of the server package, but don't forget to make it consistent with client-side `.env` file.

> **Done!** If you are succeeded, your browser will be opened automatically.

## HubSpot Integration Setup

HubSpot Calling SDK Integration provides live example in development local environment

> [!NOTE]
> This is not real live ready to deploy HubSpot Application

- [x] **Done!** If you are succeeded, your browser will be opened automatically.

### Running HubSpot example

Run following command from terminal:

```
yarn start-hubspot
```

> [!NOTE]
> the `yarn start` command will automatically open a new tab in your browser at https://localhost:9025/, and you may need to bypass a "Your connection is not secure" warning in order to access the application.

### Configuration steps from HubSpot side

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
