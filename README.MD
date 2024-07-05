# Getting Started with Configuring External Call flow Application

This is a Full-stack Web Application for 3CX Call Control API demonstration.

## Configuration steps from PBX Side

1. From `Admin Menu > Advanced > Call Processing Scripts` Create new `Route Point` assigned to "dial code" and specify following processing script:

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

2.  Provide required configuration for created Route Point from `Advanced > Parameters > DN Properties`.
    Configuration includes following required parameters

    - `APPID` and `APPSECRET`: These are credentials for your external application, responsible for authorizing requests to a configurable `RoutePoint`.
      > **_Please note:_** For now, you should define them yourself. Later, we will add an automatic procedure.
    - `APPHOOK`: Represents Webhook URL. Webhook is responsible for receiving messages from PBX, here you should provide endpoint URL,
      defined on your Application Server (e.g. http://localhost:8080/api/webhook/ivr). For additional Information check [Examples Webhook Routing](#applications-webhook-routing)

      > **Important!**  
      > All the fields mentioned above are required for the application to start working.

**Done!** After you complete these steps, you can start to work with particular application.

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

**Done!** After you installed dependencies, you can proceed with running the Application.

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

> **Please Note:** the `yarn start` command will automatically open a new tab in your browser at https://localhost:8081 with client-side part, and concurrently
> run Application Server at http://localhost:8080. The Application Server Base Path is configurable depending on the `.env` configuration file, which you can find inside the root folder of the server package, but don't forget to make it consistent with client-side `.env` file.

> **Done!** If you are succeeded, your browser will be opened automatically.

### Application's Webhook Routing

Webhooks are the important part of an application, they allow receiving messages from PBX. Please make sure,
that Webhook endpoints URLs, defined on your Application Server are consistent with the URLs you provided on [PBX Configuration](#configuration-steps-from-pbx-side) for particular application inside `APPHOOK` DN Property.

By default, Example applications are providing following webhook endpoints, which you can find in `webhook.routing.ts`:

- `/api/webhook/ivr` - for **Custom IVR Example**
- `/api/webhook/campaign` - for **Outbound Campaign Example**
- `/api/webhook/dialer` - for **Dialer Example**

The resulting absolute URL will look like: http://localhost:8080/api/webhook/ivr. This is an example of what your APPHOOK field should contain.

## HubSpot Integration Setup

HubSpot Calling SDK Integration provides live example in development local environment

> **Please note**: This is not real live ready to deploy HubSpot Application

### Running HubSpot example

Run following command from terminal:

```
yarn start-hubspot
```

> **Please Note:** the `yarn start` command will automatically open a new tab in your browser at https://localhost:9025/, and you may need to bypass a "Your connection is not secure" warning in order to access the application.

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
