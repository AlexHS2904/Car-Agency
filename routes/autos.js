// routes/autos.js

import { Router } from "express";
import pool from "../db.js";
import multer from "multer";
import { randomUUID } from "crypto";
import supabase from "../supabase.js";

const router = Router();

const BUCKET = process.env.CAR_IMAGES_BUCKET || "car-images";


/* =====================================================
   ADMIN
===================================================== */

function ensureAdmin(req, res, next) {
  if (
    !req.session?.user ||
    req.session.user.role !== "admin"
  ) {
    return res.status(403).send("No tienes permiso.");
  }

  next();
}


/* =====================================================
   IMÁGENES
===================================================== */

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 5 * 1024 * 1024,
  },

  fileFilter: (_req, file, cb) => {
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp",
    ];

    if (!allowed.includes(file.mimetype)) {
      return cb(
        new Error(
          "Solo se permiten imágenes JPG, PNG o WEBP."
        )
      );
    }

    cb(null, true);
  },
});


async function uploadCarImage(file) {
  if (!file) return null;

  const extensions = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };

  const extension =
    extensions[file.mimetype] || "jpg";

  const filePath =
    `cars/${Date.now()}-${randomUUID()}.${extension}`;

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
      "Error subiendo imagen:",
      error
    );

    throw error;
  }

  const { data } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(filePath);

  return data.publicUrl;
}


async function deleteCarImage(imageUrl) {
  if (!imageUrl) return;

  const marker =
    `/storage/v1/object/public/${BUCKET}/`;

  const index =
    imageUrl.indexOf(marker);

  // La imagen no pertenece a nuestro bucket.
  if (index === -1) {
    return;
  }

  try {
    const filePath =
      decodeURIComponent(
        imageUrl.substring(
          index + marker.length
        )
      );

    const { error } =
      await supabase.storage
        .from(BUCKET)
        .remove([filePath]);

    if (error) {
      console.error(
        "Error eliminando imagen:",
        error
      );
    }

  } catch (err) {
    console.error(
      "Error procesando imagen:",
      err
    );
  }
}


/* =====================================================
   INVENTARIO
   GET /autos
===================================================== */

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
        COALESCE(c.image_url, '') AS image_url,
        COALESCE(c.status, 'available') AS status,
        c.body_type,
        c.seats,
        c.description,
        c.created_at,

        (
          SELECT COUNT(*)::int
          FROM reservations r
          WHERE r.car_id = c.id
        ) AS reservas_total

      FROM cars c

      WHERE 1 = 1
    `;

    const params = [];


    if (
      q &&
      q.trim() !== ""
    ) {
      sql += `
        AND (
          c.brand ILIKE ?
          OR c.model ILIKE ?
          OR COALESCE(c.body_type, '') ILIKE ?
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
        "GET /autos:",
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
   /admin/autos
===================================================== */

router.get(
  "/admin/autos",
  ensureAdmin,
  (_req, res) => {
    return res.redirect("/autos");
  }
);


/* =====================================================
   NUEVO AUTO
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

      const errors = [];


      if (!brand?.trim()) {
        errors.push(
          "La marca es obligatoria."
        );
      }

      if (!model?.trim()) {
        errors.push(
          "El modelo es obligatorio."
        );
      }


      const y = Number(year);

      const currentYear =
        new Date().getFullYear();

      if (
        Number.isNaN(y) ||
        y < 1980 ||
        y > currentYear + 1
      ) {
        errors.push(
          "Año inválido."
        );
      }


      const price =
        Number(price_per_day);

      if (
        Number.isNaN(price) ||
        price <= 0
      ) {
        errors.push(
          "Precio inválido."
        );
      }


      let seatsVal = null;

      if (seats) {
        const s = Number(seats);

        if (
          !Number.isInteger(s) ||
          s <= 0
        ) {
          errors.push(
            "Número de asientos inválido."
          );
        } else {
          seatsVal = s;
        }
      }


      if (errors.length > 0) {
        return res
          .status(400)
          .render(
            "admin/new-car",
            {
              error: errors.join(" "),

              preset: req.body,
            }
          );
      }


      let finalImage = null;


      if (req.file) {
        finalImage =
          await uploadCarImage(
            req.file
          );

      } else if (
        image_url?.trim()
      ) {
        finalImage =
          image_url.trim();
      }


      await pool.query(
        `
        INSERT INTO cars (
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

        VALUES (
          ?, ?, ?, ?,
          'available',
          ?, ?, ?, ?,
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
        "Crear auto:",
        err
      );

      return res
        .status(500)
        .render(
          "admin/new-car",
          {
            error:
              "No se pudo guardar el auto.",

            preset:
              req.body || null,
          }
        );
    }
  }
);


/* =====================================================
   EDITAR AUTO
===================================================== */

router.get(
  "/admin/autos/:id/editar",
  ensureAdmin,
  async (req, res) => {

    try {
      const [[car]] =
        await pool.query(
          `
          SELECT *
          FROM cars
          WHERE id = ?
          `,
          [req.params.id]
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
        "Editar auto GET:",
        err
      );

      return res
        .status(500)
        .send(
          "Error cargando auto."
        );
    }
  }
);


router.post(
  "/admin/autos/:id/editar",
  ensureAdmin,
  upload.single("image"),
  async (req, res) => {

    const { id } =
      req.params;

    try {
      const [[currentCar]] =
        await pool.query(
          `
          SELECT *
          FROM cars
          WHERE id = ?
          `,
          [id]
        );


      if (!currentCar) {
        return res
          .status(404)
          .send(
            "Auto no encontrado."
          );
      }


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


      const y =
        Number(year);

      const price =
        Number(price_per_day);

      const seatsVal =
        seats
          ? Number(seats)
          : null;


      let finalImage =
        currentCar.image_url;


      /* Nueva imagen subida */

      if (req.file) {

        const newImage =
          await uploadCarImage(
            req.file
          );


        await deleteCarImage(
          currentCar.image_url
        );


        finalImage =
          newImage;

      } else if (
        image_url?.trim()
      ) {

        const newUrl =
          image_url.trim();


        if (
          newUrl !==
          currentCar.image_url
        ) {
          await deleteCarImage(
            currentCar.image_url
          );
        }


        finalImage =
          newUrl;
      }


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
          status = ?,
          image_url = ?

        WHERE id = ?
        `,
        [
          brand.trim(),
          model.trim(),
          y,
          price,
          body_type || null,
          seatsVal,
          description || null,
          status || "available",
          finalImage,
          id,
        ]
      );


      return res.redirect(
        "/autos"
      );

    } catch (err) {
      console.error(
        "Editar auto POST:",
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
   ELIMINAR AUTO

   ESTA ES LA RUTA QUE TE FALTABA
===================================================== */

router.post(
  "/admin/autos/:id/eliminar",
  ensureAdmin,
  async (req, res) => {

    const { id } =
      req.params;

    try {

      /* Buscar el auto */

      const [[car]] =
        await pool.query(
          `
          SELECT
            id,
            brand,
            model,
            image_url

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


      /* Revisar reservaciones */

      const [[reservationData]] =
        await pool.query(
          `
          SELECT
            COUNT(*)::int AS total

          FROM reservations

          WHERE car_id = ?
          `,
          [id]
        );


      /*
       * No borramos autos que tengan historial
       * de reservaciones para no romper datos.
       */

      if (
        Number(
          reservationData.total
        ) > 0
      ) {

        return res
          .status(400)
          .send(
            `No se puede eliminar ${car.brand} ${car.model} porque tiene reservaciones registradas.`
          );
      }


      /* Eliminar auto */

      await pool.query(
        `
        DELETE FROM cars
        WHERE id = ?
        `,
        [id]
      );


      /* Eliminar foto de Supabase */

      await deleteCarImage(
        car.image_url
      );


      console.log(
        `Auto eliminado: ${car.brand} ${car.model}`
      );


      return res.redirect(
        "/autos"
      );

    } catch (err) {

      console.error(
        "ELIMINAR AUTO:",
        err
      );


      return res
        .status(500)
        .send(
          "No se pudo eliminar el auto."
        );
    }
  }
);


/* =====================================================
   ALIAS POR SEGURIDAD

   También acepta:
   POST /autos/:id/eliminar
===================================================== */

router.post(
  "/autos/:id/eliminar",
  ensureAdmin,
  (req, res) => {

    return res.redirect(
      307,
      `/admin/autos/${req.params.id}/eliminar`
    );
  }
);


/* =====================================================
   RUTAS LEGACY DE EDITAR
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


export default router;