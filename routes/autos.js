// routes/autos.js

import { Router } from "express";
import pool from "../db.js";
import multer from "multer";
import { randomUUID } from "crypto";
import supabase from "../supabase.js";

const router = Router();

const BUCKET =
  process.env.CAR_IMAGES_BUCKET || "car-images";


/* =====================================================
   MIDDLEWARE ADMIN
===================================================== */

function ensureAdmin(req, res, next) {
  if (
    !req.session ||
    !req.session.user ||
    req.session.user.role !== "admin"
  ) {
    return res.status(403).send("No tienes permiso");
  }

  next();
}


/* =====================================================
   MULTER
   Las imágenes ya NO se guardan en public/uploads.
   Se mantienen temporalmente en memoria.
===================================================== */

const allowedMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
  },

  fileFilter: (_req, file, cb) => {
    if (!allowedMimeTypes.includes(file.mimetype)) {
      return cb(
        new Error(
          "Solo se permiten imágenes JPG, PNG o WEBP."
        )
      );
    }

    cb(null, true);
  },
});


/* =====================================================
   SUBIR IMAGEN A SUPABASE STORAGE
===================================================== */

async function uploadCarImage(file) {
  if (!file) {
    return null;
  }

  const extensions = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };

  const extension =
    extensions[file.mimetype] || "jpg";

  const fileName =
    `${Date.now()}-${randomUUID()}.${extension}`;

  const filePath =
    `cars/${fileName}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(
      filePath,
      file.buffer,
      {
        contentType: file.mimetype,
        cacheControl: "3600",
        upsert: false,
      }
    );

  if (error) {
    console.error(
      "Error subiendo imagen a Supabase:",
      error
    );

    throw new Error(
      "No se pudo subir la imagen."
    );
  }

  const { data } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(filePath);

  if (!data?.publicUrl) {
    throw new Error(
      "No se pudo obtener la URL de la imagen."
    );
  }

  return data.publicUrl;
}


/* =====================================================
   INVENTARIO
===================================================== */

// /autos
router.get(
  "/autos",
  ensureAdmin,
  async (req, res) => {

    const { q } = req.query;

    let sql = `
      SELECT
        c.id,
        c.brand,
        c.model,
        c.year,
        c.price_per_day,

        COALESCE(
          c.image_url,
          ''
        ) AS image_url,

        COALESCE(
          c.status,
          'available'
        ) AS status,

        c.created_at,

        (
          SELECT COUNT(*)
          FROM reservations r
          WHERE r.car_id = c.id
        ) AS reservas_total

      FROM cars c

      WHERE 1 = 1
    `;

    const params = [];


    // Búsqueda
    if (
      q &&
      q.trim() !== ""
    ) {

      sql += `
        AND (
          c.brand ILIKE ?
          OR c.model ILIKE ?
          OR c.body_type ILIKE ?
        )
      `;

      const search =
        `%${q.trim()}%`;

      params.push(
        search,
        search,
        search
      );
    }


    sql += `
      ORDER BY c.id DESC
    `;


    try {

      const [cars] =
        await pool.query(
          sql,
          params
        );


      return res.render(
        "admin/inventory",
        {
          cars,
          q: q || "",
        }
      );

    } catch (err) {

      console.error(
        "GET /autos error:",
        err
      );

      return res
        .status(500)
        .send(
          "Error cargando inventario."
        );
    }
  }
);


/* =====================================================
   RUTA ESPEJO /admin/autos
===================================================== */

router.get(
  "/admin/autos",
  ensureAdmin,
  async (req, res) => {

    req.url =
      "/autos" +
      (
        req.url.includes("?")
          ? req.url.slice(
              req.url.indexOf("?")
            )
          : ""
      );

    return router.handle(
      req,
      res
    );
  }
);


/* =====================================================
   NUEVO AUTO - GET
===================================================== */

router.get(
  "/admin/autos/nuevo",
  ensureAdmin,
  (_req, res) => {

    return res.render(
      "admin/new-car",
      {
        error: null,
        preset: null,
      }
    );
  }
);


/* =====================================================
   NUEVO AUTO - POST
===================================================== */

router.post(
  "/admin/autos/nuevo",

  ensureAdmin,

  upload.single("image"),

  async (req, res) => {

    try {

      const {
        brand,
        model,
        year,
        price_per_day,
        body_type,
        seats,
        image_url,
        description,
      } = req.body;


      /* -------------------------
         VALIDACIONES
      ------------------------- */

      const errors = [];

      if (
        !brand ||
        !brand.trim()
      ) {
        errors.push(
          "La marca es obligatoria."
        );
      }

      if (
        !model ||
        !model.trim()
      ) {
        errors.push(
          "El modelo es obligatorio."
        );
      }

      if (!year) {
        errors.push(
          "El año es obligatorio."
        );
      }

      if (!price_per_day) {
        errors.push(
          "El precio por día es obligatorio."
        );
      }


      /* Año */

      const y =
        Number(year);

      const currentYear =
        new Date().getFullYear();

      if (
        Number.isNaN(y) ||
        y < 1980 ||
        y > currentYear + 1
      ) {
        errors.push(
          `El año debe estar entre 1980 y ${currentYear + 1}.`
        );
      }


      /* Precio */

      const price =
        Number(price_per_day);

      if (
        Number.isNaN(price) ||
        price <= 0
      ) {
        errors.push(
          "El precio debe ser un número mayor a 0."
        );
      }


      /* Asientos */

      let seatsVal = null;

      if (
        seats &&
        seats !== ""
      ) {

        const s =
          Number(seats);

        if (
          Number.isNaN(s) ||
          !Number.isInteger(s) ||
          s <= 0
        ) {

          errors.push(
            "Los asientos deben ser un número entero positivo."
          );

        } else {

          seatsVal = s;
        }
      }


      /* -------------------------
         SI HAY ERRORES
      ------------------------- */

      if (
        errors.length > 0
      ) {

        return res
          .status(400)
          .render(
            "admin/new-car",
            {
              error:
                errors.join(" "),

              preset: {
                brand,
                model,
                year,
                price_per_day,
                body_type,
                seats:
                  seatsVal,
                image_url,
                description,
              },
            }
          );
      }


      /* -------------------------
         IMAGEN
      ------------------------- */

      let finalImage = null;

      // Si se subió un archivo
      if (req.file) {

        finalImage =
          await uploadCarImage(
            req.file
          );

      }

      // Si escribieron URL manual
      else if (
        image_url &&
        image_url.trim()
      ) {

        finalImage =
          image_url.trim();
      }


      /* -------------------------
         INSERTAR AUTO
      ------------------------- */

      await pool.query(
        `
        INSERT INTO cars
        (
          brand,
          model,
          year,
          price_per_day,
          status,
          image_url,
          body_type,
          seats,
          description,
          created_at
        )

        VALUES
        (
          ?,
          ?,
          ?,
          ?,
          'available',
          ?,
          ?,
          ?,
          ?,
          NOW()
        )
        `,
        [
          brand.trim(),
          model.trim(),
          y,
          price,
          finalImage,
          body_type || null,
          seatsVal,
          description || null,
        ]
      );


      return res.redirect(
        "/autos"
      );

    } catch (err) {

      console.error(
        "POST /admin/autos/nuevo error:",
        err
      );

      return res
        .status(500)
        .render(
          "admin/new-car",
          {
            error:
              "Ocurrió un error al guardar el auto.",

            preset:
              req.body || null,
          }
        );
    }
  }
);


/* =====================================================
   EDITAR AUTO - GET
===================================================== */

router.get(
  "/admin/autos/:id/editar",

  ensureAdmin,

  async (req, res) => {

    const { id } =
      req.params;

    try {

      const [[car]] =
        await pool.query(
          `
          SELECT
            c.id,
            c.brand,
            c.model,
            c.year,
            c.price_per_day,

            COALESCE(
              c.image_url,
              ''
            ) AS image_url,

            COALESCE(
              c.status,
              'available'
            ) AS status,

            c.body_type,
            c.seats,
            c.description

          FROM cars c

          WHERE c.id = ?
          `,
          [id]
        );


      if (!car) {

        return res
          .status(404)
          .send(
            "Auto no encontrado."
          );
      }


      return res.render(
        "admin/car_edit",
        {
          car,
          error: null,
        }
      );

    } catch (err) {

      console.error(
        "GET /admin/autos/:id/editar error:",
        err
      );

      return res
        .status(500)
        .send(
          "Error cargando el auto."
        );
    }
  }
);


/* =====================================================
   EDITAR AUTO - POST
===================================================== */

router.post(
  "/admin/autos/:id/editar",

  ensureAdmin,

  upload.single("image"),

  async (req, res) => {

    const { id } =
      req.params;


    try {

      const {
        brand,
        model,
        year,
        price_per_day,
        body_type,
        seats,
        image_url,
        description,
        status,
      } = req.body;


      /* -------------------------
         VALIDACIONES
      ------------------------- */

      const errors = [];


      if (
        !brand ||
        !brand.trim()
      ) {
        errors.push(
          "La marca es obligatoria."
        );
      }


      if (
        !model ||
        !model.trim()
      ) {
        errors.push(
          "El modelo es obligatorio."
        );
      }


      if (!year) {

        errors.push(
          "El año es obligatorio."
        );
      }


      if (!price_per_day) {

        errors.push(
          "El precio por día es obligatorio."
        );
      }


      /* Año */

      const y =
        Number(year);

      const currentYear =
        new Date().getFullYear();

      if (
        Number.isNaN(y) ||
        y < 1980 ||
        y > currentYear + 1
      ) {

        errors.push(
          `El año debe estar entre 1980 y ${currentYear + 1}.`
        );
      }


      /* Precio */

      const price =
        Number(price_per_day);

      if (
        Number.isNaN(price) ||
        price <= 0
      ) {

        errors.push(
          "El precio debe ser un número mayor a 0."
        );
      }


      /* Asientos */

      let seatsVal = null;

      if (
        seats &&
        seats !== ""
      ) {

        const s =
          Number(seats);

        if (
          Number.isNaN(s) ||
          !Number.isInteger(s) ||
          s <= 0
        ) {

          errors.push(
            "Los asientos deben ser un número entero positivo."
          );

        } else {

          seatsVal = s;
        }
      }


      /* -------------------------
         SI HAY ERRORES
      ------------------------- */

      if (
        errors.length > 0
      ) {

        const [[car]] =
          await pool.query(
            `
            SELECT *
            FROM cars
            WHERE id = ?
            `,
            [id]
          );


        if (!car) {

          return res
            .status(404)
            .send(
              "Auto no encontrado."
            );
        }


        return res
          .status(400)
          .render(
            "admin/car_edit",
            {
              car: {
                ...car,

                // Mostramos lo escrito por el usuario
                brand,
                model,
                year,
                price_per_day,
                body_type,
                seats:
                  seatsVal,
                description,
                status,

                image_url:
                  image_url ||
                  car.image_url ||
                  "",
              },

              error:
                errors.join(" "),
            }
          );
      }


      /* -------------------------
         IMAGEN
      ------------------------- */

      let finalImage = null;


      // Nueva imagen subida
      if (req.file) {

        finalImage =
          await uploadCarImage(
            req.file
          );

      }

      // URL escrita manualmente
      else if (
        typeof image_url === "string"
      ) {

        finalImage =
          image_url.trim() ||
          null;
      }


      /* -------------------------
         CAMPOS UPDATE
      ------------------------- */

      const fields = [
        brand.trim(),
        model.trim(),
        y,
        price,
        body_type || null,
        seatsVal,
        description || null,
        status || "available",
      ];


      let setImageSQL = "";


      /*
        Solo actualizamos image_url si recibimos
        una imagen nueva o una URL desde el formulario.

        Si no llega nada, conservamos la que ya
        estaba guardada.
      */

      if (
        finalImage !== null
      ) {

        setImageSQL =
          `,
          image_url = ?
          `;

        fields.push(
          finalImage
        );
      }


      fields.push(id);


      /* -------------------------
         UPDATE
      ------------------------- */

      await pool.query(
        `
        UPDATE cars

        SET
          brand = ?,
          model = ?,
          year = ?,
          price_per_day = ?,
          body_type = ?,
          seats = ?,
          description = ?,
          status = ?
          ${setImageSQL}

        WHERE id = ?
        `,
        fields
      );


      return res.redirect(
        "/autos"
      );

    } catch (err) {

      console.error(
        "POST /admin/autos/:id/editar error:",
        err
      );

      return res
        .status(500)
        .send(
          "No se pudo actualizar el auto."
        );
    }
  }
);


/* =====================================================
   RUTAS LEGACY
===================================================== */

router.get(
  "/autos/:id/editar",

  ensureAdmin,

  (req, res) => {

    return res.redirect(
      `/admin/autos/${req.params.id}/editar`
    );
  }
);


router.post(
  "/autos/:id/editar",

  ensureAdmin,

  (req, res) => {

    return res.redirect(
      307,
      `/admin/autos/${req.params.id}/editar`
    );
  }
);


export default router;