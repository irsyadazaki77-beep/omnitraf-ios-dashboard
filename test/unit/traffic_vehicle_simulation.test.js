import test from 'node:test';
import assert from 'node:assert/strict';
import { TrafficVehicleSimulation, projectTrafficVehicle } from '../../shared/trafficVehicleSimulation.js';

const makeSimulation = () => new TrafficVehicleSimulation({ seed: 412 });

test('vehicle simulation is deterministic for the same seed and tick sequence', () => {
  const state = { trafficModel: { averageSpeedKmh: 32, corridors: [{ corridorId: 'corridor-ayani', speedKmh: 28 }] }, intersections: [] };
  const first = makeSimulation(), second = makeSimulation();
  for (let index = 0; index < 40; index++) { first.step(state, .3); second.step(state, .3); }
  assert.deepEqual(first.getSnapshot().vehicles, second.getSnapshot().vehicles);
});

test('vehicles brake and queue at the authoritative red signal, then accelerate on green', () => {
  const simulation = makeSimulation();
  const vehicle = simulation.getVehicles('cctvCanvas1').find(item => item.lane === 0);
  vehicle.progress = .72;
  vehicle.speedKmh = 20;
  const state = { trafficModel: { corridors: [{ corridorId: 'corridor-ayani', speedKmh: 36 }] }, intersections: [{ id: 'node-wonokromo', state: 'red' }] };
  for (let tick = 0; tick < 80; tick++) simulation.step(state, .3);
  assert.ok(vehicle.progress <= .80);
  assert.ok(vehicle.stopped || vehicle.speedKmh < 1);
  const stoppedSpeed = vehicle.speedKmh;
  simulation.step({ ...state, intersections: [{ id: 'node-wonokromo', state: 'green' }] }, .3);
  assert.ok(vehicle.speedKmh > stoppedSpeed);
});

test('same-lane followers brake before reaching a slower leader', () => {
  const simulation = makeSimulation();
  const laneVehicles = simulation.getVehicles('cctvCanvas2').filter(item => item.lane === 0);
  const [leader, follower] = laneVehicles;
  leader.progress = .5; leader.speedKmh = 4;
  follower.progress = .45; follower.speedKmh = 35;
  const state = { trafficModel: { corridors: [{ corridorId: 'corridor-darmo', speedKmh: 5, queueVehicles: 20 }] }, intersections: [] };
  let sawFollowerBrake = false;
  for (let tick = 0; tick < 30; tick++) {
    simulation.step(state, .3);
    sawFollowerBrake ||= follower.braking;
  }
  assert.ok(leader.progress - follower.progress > .015);
  assert.ok(follower.speedKmh < 35);
  assert.equal(sawFollowerBrake, true);
});

test('corridor speed, rain, incidents, and camera paths affect simulated traffic consistently', () => {
  const dry = makeSimulation(), incident = makeSimulation();
  const normalState = { trafficModel: { averageSpeedKmh: 40, corridors: [{ corridorId: 'corridor-darmo', speedKmh: 38 }] }, intersections: [] };
  const incidentState = { ...normalState, roadCondition: 'wet', incidents: [{ status: 'ACTIVE', corridorId: 'corridor-darmo', laneClosed: true }] };
  for (let tick = 0; tick < 25; tick++) { dry.step(normalState, .3); incident.step(incidentState, .3); }
  const normalCars = dry.getVehicles('cctvCanvas2');
  const incidentCars = incident.getVehicles('cctvCanvas2');
  assert.ok(incidentCars.reduce((sum, car) => sum + car.speedKmh, 0) < normalCars.reduce((sum, car) => sum + car.speedKmh, 0));
  const roundaboutPosition = projectTrafficVehicle(dry.getVehicles('cctvCanvas3')[0], 'roundabout');
  const boulevardPosition = projectTrafficVehicle(dry.getVehicles('cctvCanvas2')[0], 'boulevard');
  assert.notDeepEqual(roundaboutPosition, boulevardPosition);
});

test('snapshot restore continues the vehicle simulation state', () => {
  const original = makeSimulation();
  const state = { trafficModel: { averageSpeedKmh: 30 }, intersections: [] };
  original.step(state, .3);
  const restored = makeSimulation();
  restored.restoreSnapshot(original.getSnapshot());
  original.step(state, .3); restored.step(state, .3);
  assert.deepEqual(restored.getSnapshot().vehicles, original.getSnapshot().vehicles);
});
