import { useState, ChangeEvent } from "react";
import { useAutoFocus } from "../../hooks/useAutoFocus";
import {
  Wrapper,
  RoundedInput,
  RoundedButton,
  LinkButton,
  Row,
} from "../Components";
import { ScreenProps } from "../../types/ScreenTypes";
import { PANTERA } from "../../utils/colors";

/**
 * In HubSpot Example there is username and password for calling account
 * For 3cx Intefration you need to connect your ExternalCallFlowApplication
 * using your pbx base url and credentials from PBX: APP_ID and APP_SECRET
 * @param param0
 * @returns
 */
function LoginScreen({ cti, handleNextScreen }: ScreenProps) {
  const usernameInput = useAutoFocus();
  const [pbxBase, setPbxBase] = useState("");
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [serverError, setServerError] = useState<string | undefined>(undefined);

  const handleLogin = async () => {
    setServerError(undefined);
    if (!pbxBase || !appId || !appSecret) {
      setServerError("Form fields are required");
      return;
    }
    try {
      const response = await fetch(
        `${process.env.REACT_APP_SERVER_BASE}/api/connect?appId=2`,
        {
          method: "POST",
          body: JSON.stringify({
            pbxBase,
            appId,
            appSecret,
          }),
          headers: {
            "Content-type": "application/json",
          },
        }
      );
      const json = await response.json();
      if (json?.errorMessage) {
        setServerError(json.errorMessage);
        return;
      }
      cti.userLoggedIn();
      handleNextScreen();
    } catch (e) {
      setServerError("Failed to connect to Application server");
    }
  };

  const handlePbxBase = ({
    target: { value },
  }: ChangeEvent<HTMLInputElement>) => setPbxBase(value);
  const handleAppId = ({ target: { value } }: ChangeEvent<HTMLInputElement>) =>
    setAppId(value);
  const handleAppSecret = ({
    target: { value },
  }: ChangeEvent<HTMLInputElement>) => setAppSecret(value);

  return (
    <Wrapper style={{ color: PANTERA }}>
      <form>
        <h4 style={{ textAlign: "center" }}>Log into your calling account</h4>
        {serverError && (
          <div
            style={{
              textAlign: "center",
              marginBottom: "15px",
              padding: "8px",
              background: "rgba(245, 17, 17, 0.49)",
              color: "white",
            }}
          >
            {serverError}
          </div>
        )}
        <div style={{ marginBottom: "5px", fontSize: "14px" }}>
          PBX Base URL
        </div>
        <RoundedInput
          value={pbxBase}
          onChange={handlePbxBase}
          ref={usernameInput}
          autoComplete="username"
        />
        <div style={{ marginBottom: "5px", fontSize: "14px" }}>APP ID</div>
        <RoundedInput
          value={appId}
          onChange={handleAppId}
          autoComplete="current-password"
        />
        <div style={{ marginBottom: "5px", fontSize: "14px" }}>APP SECRET</div>
        <RoundedInput
          value={appSecret}
          onChange={handleAppSecret}
          autoComplete="current-password"
        />
        <br />
        <Row>
          <RoundedButton use="primary" onClick={handleLogin} type="button">
            Log in
          </RoundedButton>
        </Row>
        <br />
        <Row>
          <LinkButton
            use="transparent-on-primary"
            onClick={handleLogin}
            type="button"
          >
            Sign in with SSO
          </LinkButton>
        </Row>
      </form>
    </Wrapper>
  );
}

export default LoginScreen;
