import React, { useEffect, useRef } from "react";
import * as THREE from "three";

interface StarfieldBackgroundProps {
  className?: string;
}

const StarfieldBackground: React.FC<StarfieldBackgroundProps> = ({ className = "" }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mouseRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Create scene
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0015, 0.0008);

    // Create camera
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 2000);
    camera.position.z = 1000;

    // Create renderer
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // Create main stars
    const starsGeometry = new THREE.BufferGeometry();
    const starsMaterial = new THREE.PointsMaterial({
      size: 2,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });

    const starsVertices: number[] = [];
    const starsColors: number[] = [];
    const starsSizes: number[] = [];
    const starCount = 6000;

    for (let i = 0; i < starCount; i++) {
      // Distribute stars in a sphere
      const radius = 800 + Math.random() * 1200;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      const x = radius * Math.sin(phi) * Math.cos(theta);
      const y = radius * Math.sin(phi) * Math.sin(theta);
      const z = radius * Math.cos(phi);
      starsVertices.push(x, y, z);

      // Color palette - purple/blue/pink theme
      const colorChoice = Math.random();
      let r, g, b;
      if (colorChoice < 0.25) {
        // White stars
        r = 1; g = 1; b = 1;
      } else if (colorChoice < 0.45) {
        // Purple stars
        r = 0.7 + Math.random() * 0.3;
        g = 0.4 + Math.random() * 0.3;
        b = 1;
      } else if (colorChoice < 0.65) {
        // Blue stars
        r = 0.4 + Math.random() * 0.2;
        g = 0.5 + Math.random() * 0.3;
        b = 1;
      } else if (colorChoice < 0.85) {
        // Pink stars
        r = 1;
        g = 0.5 + Math.random() * 0.3;
        b = 0.8 + Math.random() * 0.2;
      } else {
        // Cyan stars
        r = 0.3 + Math.random() * 0.2;
        g = 0.8 + Math.random() * 0.2;
        b = 1;
      }
      starsColors.push(r, g, b);
      starsSizes.push(0.5 + Math.random() * 2);
    }

    starsGeometry.setAttribute("position", new THREE.Float32BufferAttribute(starsVertices, 3));
    starsGeometry.setAttribute("color", new THREE.Float32BufferAttribute(starsColors, 3));

    const stars = new THREE.Points(starsGeometry, starsMaterial);
    scene.add(stars);

    // Store original colors for twinkling
    const originalColors = [...starsColors];

    // Create larger, brighter stars
    const brightStarsGeometry = new THREE.BufferGeometry();
    const brightStarsMaterial = new THREE.PointsMaterial({
      size: 4,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });

    const brightStarsVertices: number[] = [];
    const brightStarsColors: number[] = [];
    const brightStarCount = 150;

    for (let i = 0; i < brightStarCount; i++) {
      const radius = 600 + Math.random() * 800;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      const x = radius * Math.sin(phi) * Math.cos(theta);
      const y = radius * Math.sin(phi) * Math.sin(theta);
      const z = radius * Math.cos(phi);
      brightStarsVertices.push(x, y, z);

      // Bright purple/white colors
      const r = 0.9 + Math.random() * 0.1;
      const g = 0.7 + Math.random() * 0.2;
      const b = 1;
      brightStarsColors.push(r, g, b);
    }

    brightStarsGeometry.setAttribute("position", new THREE.Float32BufferAttribute(brightStarsVertices, 3));
    brightStarsGeometry.setAttribute("color", new THREE.Float32BufferAttribute(brightStarsColors, 3));

    const brightStars = new THREE.Points(brightStarsGeometry, brightStarsMaterial);
    scene.add(brightStars);

    const originalBrightColors = [...brightStarsColors];

    // Create shooting stars
    const shootingStars: {
      mesh: THREE.Mesh;
      velocity: THREE.Vector3;
      life: number;
      maxLife: number;
    }[] = [];

    const createShootingStar = () => {
      const geometry = new THREE.BufferGeometry();
      const points = [];
      const trailLength = 50;

      for (let i = 0; i < trailLength; i++) {
        points.push(new THREE.Vector3(i * 3, 0, 0));
      }

      geometry.setFromPoints(points);

      const material = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
      });

      const line = new THREE.Line(geometry, material);

      // Random starting position at edge of view
      const side = Math.floor(Math.random() * 4);
      let startX, startY;
      switch (side) {
        case 0: // Top
          startX = (Math.random() - 0.5) * 1500;
          startY = 800;
          break;
        case 1: // Right
          startX = 800;
          startY = (Math.random() - 0.5) * 1500;
          break;
        case 2: // Bottom
          startX = (Math.random() - 0.5) * 1500;
          startY = -800;
          break;
        default: // Left
          startX = -800;
          startY = (Math.random() - 0.5) * 1500;
          break;
      }

      line.position.set(startX, startY, (Math.random() - 0.5) * 500);

      // Direction towards center with some randomness
      const dirX = -startX * 0.5 + (Math.random() - 0.5) * 200;
      const dirY = -startY * 0.5 + (Math.random() - 0.5) * 200;
      const dirZ = (Math.random() - 0.5) * 100;

      const velocity = new THREE.Vector3(dirX, dirY, dirZ).normalize().multiplyScalar(15 + Math.random() * 10);

      line.lookAt(line.position.clone().add(velocity));

      scene.add(line);

      return {
        mesh: line as any,
        velocity,
        life: 0,
        maxLife: 60 + Math.random() * 60,
      };
    };

    // Create nebula clouds
    const nebulaGeometry = new THREE.BufferGeometry();
    const nebulaVertices: number[] = [];
    const nebulaColors: number[] = [];
    const nebulaCount = 300;

    for (let i = 0; i < nebulaCount; i++) {
      const x = (Math.random() - 0.5) * 2000;
      const y = (Math.random() - 0.5) * 2000;
      const z = (Math.random() - 0.5) * 1000 - 500;
      nebulaVertices.push(x, y, z);

      // Soft purple/pink colors for nebula
      const colorChoice = Math.random();
      if (colorChoice < 0.5) {
        nebulaColors.push(0.4, 0.2, 0.8); // Purple
      } else {
        nebulaColors.push(0.6, 0.3, 0.7); // Pink-purple
      }
    }

    nebulaGeometry.setAttribute("position", new THREE.Float32BufferAttribute(nebulaVertices, 3));
    nebulaGeometry.setAttribute("color", new THREE.Float32BufferAttribute(nebulaColors, 3));

    const nebulaMaterial = new THREE.PointsMaterial({
      size: 30,
      transparent: true,
      opacity: 0.15,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });

    const nebula = new THREE.Points(nebulaGeometry, nebulaMaterial);
    scene.add(nebula);

    // Mouse tracking
    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current = {
        x: (e.clientX / window.innerWidth) * 2 - 1,
        y: -(e.clientY / window.innerHeight) * 2 + 1,
      };
    };
    window.addEventListener("mousemove", handleMouseMove);

    // Animation
    let animationId: number;
    let time = 0;
    let lastShootingStarTime = 0;

    const animate = () => {
      animationId = requestAnimationFrame(animate);
      time += 0.003;

      // Very slow rotation based on mouse position
      const targetRotationY = mouseRef.current.x * 0.05;
      const targetRotationX = mouseRef.current.y * 0.05;

      stars.rotation.y += (targetRotationY - stars.rotation.y) * 0.01;
      stars.rotation.x += (targetRotationX - stars.rotation.x) * 0.01;
      brightStars.rotation.y = stars.rotation.y * 0.8;
      brightStars.rotation.x = stars.rotation.x * 0.8;
      nebula.rotation.y = stars.rotation.y * 0.5;

      // Subtle automatic rotation
      stars.rotation.y += 0.00005;
      brightStars.rotation.y -= 0.00003;

      // Twinkling effect for main stars
      const colors = starsGeometry.attributes.color.array as Float32Array;
      for (let i = 0; i < starCount; i++) {
        const i3 = i * 3;
        const frequency = 0.2 + (i % 30) * 0.02;
        const phase = i * 0.01;
        const twinkle = 0.6 + Math.sin(time * frequency + phase) * 0.4;

        colors[i3] = originalColors[i3] * twinkle;
        colors[i3 + 1] = originalColors[i3 + 1] * twinkle;
        colors[i3 + 2] = originalColors[i3 + 2] * twinkle;
      }
      starsGeometry.attributes.color.needsUpdate = true;

      // Twinkling for bright stars
      const brightColors = brightStarsGeometry.attributes.color.array as Float32Array;
      for (let i = 0; i < brightStarCount; i++) {
        const i3 = i * 3;
        const frequency = 0.15 + (i % 15) * 0.02;
        const phase = i * 0.02;
        const twinkle = 0.7 + Math.sin(time * frequency + phase) * 0.3;

        brightColors[i3] = originalBrightColors[i3] * twinkle;
        brightColors[i3 + 1] = originalBrightColors[i3 + 1] * twinkle;
        brightColors[i3 + 2] = originalBrightColors[i3 + 2] * twinkle;
      }
      brightStarsGeometry.attributes.color.needsUpdate = true;

      // Nebula pulse
      nebulaMaterial.opacity = 0.1 + Math.sin(time * 0.5) * 0.05;

      // Shooting stars management
      if (time - lastShootingStarTime > 0.1 && Math.random() < 0.02) {
        shootingStars.push(createShootingStar());
        lastShootingStarTime = time;
      }

      // Update shooting stars
      for (let i = shootingStars.length - 1; i >= 0; i--) {
        const star = shootingStars[i];
        star.mesh.position.add(star.velocity);
        star.life++;

        // Fade out
        const material = star.mesh.material as THREE.LineBasicMaterial;
        material.opacity = 1 - (star.life / star.maxLife);

        if (star.life >= star.maxLife) {
          scene.remove(star.mesh);
          star.mesh.geometry.dispose();
          (star.mesh.material as THREE.Material).dispose();
          shootingStars.splice(i, 1);
        }
      }

      renderer.render(scene, camera);
    };

    animate();

    // Handle resize
    const handleResize = () => {
      const newWidth = container.clientWidth;
      const newHeight = container.clientHeight;
      camera.aspect = newWidth / newHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, newHeight);
    };

    window.addEventListener("resize", handleResize);

    // Cleanup
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("mousemove", handleMouseMove);
      cancelAnimationFrame(animationId);

      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }

      renderer.dispose();
      starsGeometry.dispose();
      starsMaterial.dispose();
      brightStarsGeometry.dispose();
      brightStarsMaterial.dispose();
      nebulaGeometry.dispose();
      nebulaMaterial.dispose();

      shootingStars.forEach(star => {
        star.mesh.geometry.dispose();
        (star.mesh.material as THREE.Material).dispose();
      });
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 ${className}`}
      style={{
        background: "linear-gradient(135deg, #0a0015 0%, #1a0a2e 30%, #16213e 60%, #0f1a2e 100%)"
      }}
    />
  );
};

export default StarfieldBackground;
