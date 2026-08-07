import * as THREE from "three";
import { MarchingCubes } from "three/addons/objects/MarchingCubes.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

const RESOLUTION = 40;
const ISOLATION = 80;
const SUBTRACT = 24;
const MAX_POLYGON_COUNT = 12_000;

type Point3 = readonly [number, number, number];

function addHumanoidField(figure: MarchingCubes) {
  const add = (x: number, y: number, z: number, strength: number) => {
    figure.addBall(x, y, z, strength, SUBTRACT);
  };

  const segment = (
    from: Point3,
    to: Point3,
    count: number,
    strengthFrom: number,
    strengthTo: number,
    skipStart = false,
  ) => {
    for (let index = skipStart ? 1 : 0; index < count; index += 1) {
      const progress = index / (count - 1);

      add(
        THREE.MathUtils.lerp(from[0], to[0], progress),
        THREE.MathUtils.lerp(from[1], to[1], progress),
        THREE.MathUtils.lerp(from[2], to[2], progress),
        THREE.MathUtils.lerp(strengthFrom, strengthTo, progress),
      );
    }
  };

  // Head and neck.
  add(0.5, 0.875, 0.5, 0.25);
  add(0.5, 0.825, 0.5, 0.22);
  segment([0.5, 0.79, 0.5], [0.5, 0.745, 0.5], 2, 0.07, 0.09);

  // Rib cage and waist.
  add(0.5, 0.7, 0.5, 0.42);
  add(0.5, 0.635, 0.5, 0.4);
  add(0.5, 0.57, 0.5, 0.34);
  add(0.5, 0.515, 0.5, 0.18);

  // A continuous clavicle bridge melts both shoulders into the torso.
  segment([0.36, 0.71, 0.5], [0.64, 0.71, 0.5], 5, 0.11, 0.11);

  // The pelvis is part of the same field as the waist and thighs.
  add(0.5, 0.465, 0.5, 0.18);
  add(0.44, 0.46, 0.5, 0.1);
  add(0.56, 0.46, 0.5, 0.1);

  for (const isRight of [false, true]) {
    const x = (leftX: number) => (isRight ? 1 - leftX : leftX);

    segment(
      [x(0.365), 0.695, 0.5],
      [x(0.315), 0.565, 0.5],
      3,
      0.12,
      0.105,
    );
    segment(
      [x(0.315), 0.565, 0.5],
      [x(0.295), 0.405, 0.5],
      4,
      0.105,
      0.075,
      true,
    );
    add(x(0.29), 0.375, 0.515, 0.075);

    segment(
      [x(0.44), 0.45, 0.5],
      [x(0.415), 0.335, 0.5],
      3,
      0.15,
      0.12,
    );
    segment(
      [x(0.415), 0.335, 0.5],
      [x(0.4), 0.12, 0.5],
      5,
      0.11,
      0.075,
      true,
    );
    add(x(0.4), 0.09, 0.525, 0.085);
    add(x(0.4), 0.075, 0.57, 0.065);
  }
}

/** Builds one indexed, closed surface instead of a collection of overlapping limbs. */
export function createHumanoidGeometry() {
  const temporaryMaterial = new THREE.MeshBasicMaterial();
  const field = new MarchingCubes(
    RESOLUTION,
    temporaryMaterial,
    false,
    false,
    MAX_POLYGON_COUNT,
  );

  field.isolation = ISOLATION;
  addHumanoidField(field);
  field.update();

  const vertexCount = field.geometry.drawRange.count;
  const sourcePositions = field.geometry.getAttribute("position");
  const positions = new Float32Array(vertexCount * 3);
  positions.set(
    (sourcePositions.array as Float32Array).subarray(0, vertexCount * 3),
  );

  const compactGeometry = new THREE.BufferGeometry();
  compactGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3),
  );

  const geometry = mergeVertices(compactGeometry, 1e-4);

  if (geometry !== compactGeometry) {
    compactGeometry.dispose();
  }

  geometry.computeVertexNormals();
  geometry.computeBoundingBox();

  const center = geometry.boundingBox?.getCenter(new THREE.Vector3());
  if (center) {
    geometry.translate(-center.x, -center.y, -center.z);
  }

  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  field.geometry.dispose();
  temporaryMaterial.dispose();

  return geometry;
}
