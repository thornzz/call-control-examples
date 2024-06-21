import { QueryObserver, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  APP_TYPE_DIALER,
  PARTICIPANT_CONTROL_ANSWER,
  PARTICIPANT_CONTROL_DROP,
  PARTICIPANT_CONTROL_TRANSFER_TO,
  PARTICIPANT_STATUS_CONNECTED,
  PARTICIPANT_STATUS_DIALING,
  PARTICIPANT_STATUS_RINGING,
} from "../constants";
import Select from "./common/select";
import {
  DialerState,
  controlParticipantRequest,
  getStatusFunc,
  makeCallRequest,
} from "../shared";
import React, { ReactNode, useEffect, useRef, useState } from "react";
import { AppStatus, CallControlParticipantAction, CurrentCall } from "../types";
import CallActions from "./call-actions";
import BackSpaceBtn from "./common/bacspace-btn";
import Spinner from "./common/spinner";
import TransferComponent from "./common/transfer-component";

export default function Dialpad() {
  const queryClient = useQueryClient();
  const [dialedNumber, setDialed] = useState("");
  const [dialerState, setDialerState] = useState(DialerState.Idle);
  const [focusedCall, setFocused] = useState<CurrentCall | undefined>(
    undefined
  );
  const [ccOpertation, setCCOperation] = useState<
    CallControlParticipantAction | undefined
  >(undefined);
  const [operationDestination, setOperationDestination] = useState("");

  const [isOperationInProcess, setIsOperationInProccess] = useState(false);
  const [performingAnswer, setPerformingAnswer] = useState(false);
  const [switchingDevice, setSwitchingDevice] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const { data, refetch } = useQuery({
    queryFn: getStatusFunc(APP_TYPE_DIALER),
    queryKey: ["status", APP_TYPE_DIALER],
    refetchInterval: 4000,
  });

  useEffect(() => {
    const observer = new QueryObserver<AppStatus>(queryClient, {
      queryKey: ["status", APP_TYPE_DIALER],
    });
    inputRef.current?.focus();

    const unsubscribe = observer.subscribe((res) => {
      const currentCalls = res.data?.currentCalls;
      const connectedCall = currentCalls?.find(
        (call) => call.status === PARTICIPANT_STATUS_CONNECTED
      );
      const incomingCall = currentCalls?.find(
        (call) => call.status === PARTICIPANT_STATUS_RINGING
      );
      const outgoingCall = currentCalls?.find(
        (call) => call.status === PARTICIPANT_STATUS_DIALING
      );

      if (connectedCall && dialerState !== DialerState.Connected) {
        setDialerState(DialerState.Connected);
        setFocused(connectedCall);
      }

      if (outgoingCall && !focusedCall) {
        setFocused(outgoingCall);
        if (dialerState !== DialerState.Dialing) {
          setDialerState(DialerState.Dialing);
        }
      }

      if (incomingCall && !focusedCall && dialerState === DialerState.Idle) {
        setDialerState(DialerState.Ringing);
        setFocused(incomingCall);
      }

      if (
        currentCalls?.length === 0 &&
        focusedCall !== undefined &&
        dialerState !== DialerState.Idle
      ) {
        setDialerState(DialerState.Idle);
        setFocused(undefined);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [dialerState, setDialerState, focusedCall, setFocused, queryClient]);

  function renderButtons() {
    const content: ReactNode[] = [];
    for (let i = 1; i <= 12; i++) {
      let symbol: string | number = "";
      if (i < 10) {
        symbol = i;
      } else if (i === 10) {
        symbol = "*";
      } else if (i === 11) {
        symbol = 0;
      } else if (i === 12) {
        symbol = "#";
      }
      content.push(
        <button
          onClick={() => setDialed(dialedNumber + symbol)}
          className="btn-dialer"
          key={i}
        >
          {symbol}
        </button>
      );
    }
    return content;
  }

  const onCallAnswerBtn = async () => {
    const isIncoming = focusedCall?.isIncoming === true;
    if (isIncoming && focusedCall.directControll) {
      setPerformingAnswer(true);
      try {
        const response = await controlParticipantRequest(
          APP_TYPE_DIALER,
          PARTICIPANT_CONTROL_ANSWER,
          focusedCall.participantId
        );
        const json = await response?.json();
        console.log(json);
      } catch (e) {
        console.log(e);
      } finally {
        setPerformingAnswer(false);
        refetch();
      }
    } else {
      try {
        await makeCallRequest(APP_TYPE_DIALER, dialedNumber);
        setDialed("");
        if (dialerState !== DialerState.Dialing) {
          setDialerState(DialerState.Dialing);
        }
      } catch (e) {
        console.log(e);
        setDialerState(DialerState.Idle);
      }
    }
  };

  const onDrop = async () => {
    try {
      await controlParticipantRequest(
        APP_TYPE_DIALER,
        PARTICIPANT_CONTROL_DROP,
        focusedCall?.participantId
      );
    } catch (err) {
      console.log(err);
    } finally {
      refetch();
    }
  };
  const onCallControlParticipant = async () => {
    setIsOperationInProccess(true);
    if (!ccOpertation) {
      return;
    }
    try {
      await controlParticipantRequest(
        APP_TYPE_DIALER,
        ccOpertation,
        focusedCall?.participantId,
        operationDestination
      );
    } catch (e) {
      console.log(e);
    } finally {
      setCCOperation(undefined);
      setIsOperationInProccess(false);
      refetch();
    }
  };

  const setActiveDevice = async (id: string) => {
    setSwitchingDevice(true);
    try {
      await fetch(`${process.env.REACT_APP_SERVER_BASE}/api/dialer/setdevice`, {
        method: "POST",
        body: JSON.stringify({
          activeDeviceId: id,
        }),
        headers: {
          "Content-type": "application/json",
        },
      });
      console.log("setted");
    } catch (err) {
      console.log(err);
    } finally {
      setSwitchingDevice(false);
      setDialerState(DialerState.Idle);
      setFocused(undefined);
      refetch();
    }
  };

  const onCallControlAction = (action: CallControlParticipantAction) => {
    setOperationDestination("");
    if (ccOpertation) {
      setCCOperation(undefined);
    } else {
      setCCOperation(action);
    }
  };

  const renderStateNumber = () => {
    switch (dialerState) {
      case DialerState.Idle:
        return (
          <div className="flex justify-center items-end">
            <input
              ref={inputRef}
              className="bg-transparent focus:outline-none text-center"
              value={dialedNumber}
              onChange={(e) => setDialed(e.target.value)}
            ></input>
          </div>
        );
      case DialerState.Dialing:
      case DialerState.Connected:
      case DialerState.Ringing: {
        return (
          <div className="flex flex-col items-center justify-end">
            <span>
              {focusedCall?.party ? (
                <div className="flex flex-col gap-2">
                  <span className="text-center">{focusedCall.party}</span>
                  <span
                    className={`flex items-center gap-1 font-bold text-sm animate-pulse ${
                      dialerState === DialerState.Connected
                        ? "text-green-500"
                        : "text-yellow-400"
                    }`}
                  >
                    <svg
                      className={`w-[12px] h-[12px] ${
                        dialerState === DialerState.Connected
                          ? "fill-green-500"
                          : "fill-yellow-400"
                      }`}
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 512 512"
                    >
                      <path d="M164.9 24.6c-7.7-18.6-28-28.5-47.4-23.2l-88 24C12.1 30.2 0 46 0 64C0 311.4 200.6 512 448 512c18 0 33.8-12.1 38.6-29.5l24-88c5.3-19.4-4.6-39.7-23.2-47.4l-96-40c-16.3-6.8-35.2-2.1-46.3 11.6L304.7 368C234.3 334.7 177.3 277.7 144 207.3L193.3 167c13.7-11.2 18.4-30 11.6-46.3l-40-96z" />
                    </svg>
                    {dialerState === DialerState.Connected
                      ? "Conencted"
                      : "Dialing"}
                  </span>
                </div>
              ) : (
                <Spinner />
              )}
            </span>
            {focusedCall?.name && <span>{focusedCall.name}</span>}
          </div>
        );
      }
    }
  };

  return (
    <div className="w-[450px] h-[650px] bg-darkBg flex flex-col">
      <div>
        {data?.devices && (
          <Select
            id={APP_TYPE_DIALER}
            data={data?.devices ?? []}
            selectedId={data?.activeDeviceId}
            onSelect={setActiveDevice}
          />
        )}
      </div>
      <div
        className="h-2/5 text-white font-bold text-xl grid grid-rows-2"
        onClick={() => inputRef.current?.focus()}
      >
        {renderStateNumber()}
        {dialerState === DialerState.Idle && (
          <div className="flex justify-end items-center">
            <BackSpaceBtn
              onClickBS={() =>
                setDialed(dialedNumber.substring(0, dialedNumber.length - 1))
              }
            />
          </div>
        )}
        {dialerState !== DialerState.Idle && ccOpertation !== undefined && (
          <TransferComponent
            inputRef={inputRef}
            onOperation={onCallControlParticipant}
            onPerformingOperation={isOperationInProcess}
            destinationNumber={operationDestination}
            setDestinationNumber={setOperationDestination}
            label={
              ccOpertation === PARTICIPANT_CONTROL_TRANSFER_TO
                ? "Transfer to:"
                : "Divert to:"
            }
          />
        )}
      </div>
      {dialerState === DialerState.Idle ? (
        <div className="h-3/5 border-t-2 border-b-2 border-darklight grid grid-cols-3 text-white text-center font-bold text-lg">
          {renderButtons()}
        </div>
      ) : (
        <CallActions onCallAction={onCallControlAction} state={dialerState} />
      )}
      <div className="h-1/6 flex flex-row">
        {(dialerState === DialerState.Idle ||
          dialerState === DialerState.Ringing) && (
          <div className="flex justify-center items-center w-full">
            <button
              type="button"
              disabled={
                switchingDevice ||
                performingAnswer ||
                (focusedCall !== undefined
                  ? focusedCall.directControll !== true
                  : false)
              }
              onClick={() => onCallAnswerBtn()}
              className="flex justify-center items-center w-full h-full bg-green-500 hover:bg-green-700 active:scale-105 disabled:bg-gray-400 disabled:active:scale-100"
            >
              <svg
                fill="white"
                className="w-[25px] h-[25px]"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 512 512"
              >
                <path d="M164.9 24.6c-7.7-18.6-28-28.5-47.4-23.2l-88 24C12.1 30.2 0 46 0 64C0 311.4 200.6 512 448 512c18 0 33.8-12.1 38.6-29.5l24-88c5.3-19.4-4.6-39.7-23.2-47.4l-96-40c-16.3-6.8-35.2-2.1-46.3 11.6L304.7 368C234.3 334.7 177.3 277.7 144 207.3L193.3 167c13.7-11.2 18.4-30 11.6-46.3l-40-96z" />
              </svg>
            </button>
          </div>
        )}
        {dialerState !== DialerState.Idle && (
          <div className="flex justify-center items-center w-full">
            <button
              disabled={switchingDevice}
              onClick={() => onDrop()}
              className="flex justify-center items-center w-full h-full bg-red-500 hover:bg-red-700 active:scale-105"
            >
              <svg
                fill="white"
                className="w-[25px] h-[25px] rotate-[133deg]"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 512 512"
              >
                <path d="M164.9 24.6c-7.7-18.6-28-28.5-47.4-23.2l-88 24C12.1 30.2 0 46 0 64C0 311.4 200.6 512 448 512c18 0 33.8-12.1 38.6-29.5l24-88c5.3-19.4-4.6-39.7-23.2-47.4l-96-40c-16.3-6.8-35.2-2.1-46.3 11.6L304.7 368C234.3 334.7 177.3 277.7 144 207.3L193.3 167c13.7-11.2 18.4-30 11.6-46.3l-40-96z" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
