import { ClusterRuntime } from './clusterRuntime.js';
import { OMNITRAF_RUNTIME_MODE } from '../../config/env.js';

export const clusterRuntime = new ClusterRuntime({ mode: OMNITRAF_RUNTIME_MODE });
