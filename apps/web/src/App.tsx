import { useEffect, useRef, useState, type ReactNode, type MouseEvent } from "react";
import { useBeatRoom } from "./collaboration";
import "./styles.css";
import { WAVETABLES, SYNTH_PRESETS, type SynthState } from "../../../packages/shared/src/synth";