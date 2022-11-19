const { model } = require("mongoose");

sucursalSchema = require("./models/schemas/SucursalSchema");
const rolEnum = require("./models/Rol");
const Empleado = require("./models/Empleado");
const ProductoSucursal = require("./models/ProductoSucursal");
const ProductoProveedor = require("./models/ProductoProveedor");
const Cliente = require("./models/Cliente");
const Movimiento = require("./models/Movimiento");
const Notificacion = require("./models/Notificacion");
const ErrorDeIncidencia = require("./models/ErrorDeIncidencia");
const Proveedor = require("./models/Proveedor");

class Sucursal {
  constructor(idSucursal, nombreSucursal, ubicacion) {
    this.idSucursal = idSucursal;
    this.nombreSucursal = nombreSucursal;
    this.ubicacion = ubicacion;
    this.productosDeSucursal = [];
    this.proveedoresAutorizados = [];
    this.compras = [];
    this.ventas = [];
    this.empleadosDeSucursal = [];
    this.incidentesSospechosos = [];
  }

  async obtenerUsuarioLogueado() {
    let unEmpleado = await this.buscarEmpleado("123456");
    if (!unEmpleado) {
      throw new Error("No inicio Sesion!");
    }
    return unEmpleado;
  }

  async validarSiEsDeSucursal(res, nombreSucursalRecibido) {
    let usuarioLogueado = await this.obtenerUsuarioLogueado();
    if (!(nombreSucursalRecibido == usuarioLogueado[0].sucursal)) {
      throw new ErrorDeIncidencia("Entrando a sucursal que no corresponde")
    }
  }

  async recepcionarProductoSucursal(res, cuil, scanner, cant) {
    let seRecepciono = false;
    try {
      var unEmpleado = await this.obtenerUsuarioLogueado();
      if (unEmpleado) {
        let rolValido = await this.verificarRol(unEmpleado, rolEnum.RECEPCIONISTA);
        if (rolValido) {
          let unProveedor = await this.obtenerProveedor(cuil);
          if (unProveedor[0]) {
            let unProductoSucursal = await this.buscarProductoPorCodigoBarraSucursal(scanner);
            if (unProductoSucursal[0]) {
              if (this.validarIngreso(cant)) {
                await this.ActualizarStockProducto(unProductoSucursal[0], cant)
                seRecepciono = true;
                await this.generarMovimiento(cant, unProductoSucursal[0], unProveedor[0]);
              }
            }
          }
        }
      }
    } catch (err) {
      this.dispararAlerta(unEmpleado, err);
    }
    return seRecepciono;
  }

  async verificarRol(unEmpleado, unRol) {
    let verificado = false;
    console.log(unEmpleado[0].rol[0])
    console.log(unRol.name)
    if (
      !(
        unEmpleado[0].rol[0] === unRol.name ||
        unEmpleado[0].rol[0] === rolEnum.ORGANIZADOR.name
      )
    ) {
      console.log("No rol")
      throw new ErrorDeIncidencia("Intenta ejecutar una tarea no autorizada");
    }
    verificado = true;
    return verificado;
  }

  async dispararAlerta(res, err) {
    let usuarioLogueado = await this.obtenerUsuarioLogueado();
    console.log("------------------>" + err.message)
    if (err instanceof ErrorDeIncidencia) {
      console.log("Entro A error de incidencia")
      let unaNotificacion = new Notificacion({
        nombreCompletoEmpleado: usuarioLogueado[0].nombre,
        mensaje: err.message,
        fecha: new Date().toLocaleString(),
      });
      await unaNotificacion.save();
    } else {
      console.log("Otro tipo de error: " + err.name + " --> " + err.message);
    }
  }

//revisar hay stock
  async egresarProducto(dni, scanner, cant) {
    let seEgreso = false;
    try {
      var unEmpleado = this.obtenerUsuarioLogueado();
      if (unEmpleado[0]) {
        if (this.verificarRol(unEmpleado[0], rolEnum.CAJERO)) {
          let unCliente = new Cliente({
            dniCliente: dni,
            nombreCliente: "Matias",
          });
          let unProductoSucursal = await this.buscarProductoPorCodigoBarraSucursal(
            scanner
          );
          if (this.hayStock(unProductoSucursal[0], cant)) {
            if (this.validarEgreso(cant)) {
              unProductoSucursal.actualizarStock(-cant);
              seEgreso = true;
              this.generarMovimiento(cant, unProductoSucursal, unCliente);
            }
          }
        }
      }
    } catch (err) {
      this.dispararAlerta(unEmpleado, err);
    }
    return seEgreso;
  }

  async generarMovimiento(cant, unProducto, unProveedor) {
    let monto = await this.calcularMonto(cant, unProveedor, unProducto);
    let movimiento = null;
    if (unProveedor instanceof Cliente) {
      console.log("Soy cliente")
      movimiento = await this.generarVenta(cant, unProducto, unProveedor, monto);
    } else {
      console.log("Soy proveedor")
      movimiento = await this.generarCompra(cant, unProducto, unProveedor, monto);
    }
    return movimiento;
  }

  async generarVenta(cant, unProducto, proveedor, monto) {
    let venta = new Movimiento({
      cant: cant,
      descripcionProducto: unProducto.descripcion,
      nombreEnte: proveedor.nombreCliente,
      monto: monto,
      fecha: new Date().toLocaleDateString(),
      tipo: "Venta",
    });
    await venta.save();
    return venta;
  }

  async generarCompra(cant, unProducto, proveedor, monto) {
    let compra = new Movimiento({
      cant: cant,
      descripcionProducto: unProducto.descripcion,
      nombreEnte: proveedor.nombreProveedor,
      monto: monto,
      fecha: new Date().toLocaleDateString(),
      tipo: "Compra",
    });
    await compra.save();
    return compra;
  }

  async calcularMonto(cant, prov, unProducto) {
    var unMonto = 0;
    if (prov instanceof Cliente) {
      unMonto = cant * unProducto[0].precioVenta;
    } else {
      let productoBuscado= await  this.buscarProductoPorCodigoBarraProveedor(unProducto.codigoBarra)
      unMonto = parseFloat(cant) * parseFloat(productoBuscado[0].precioCompra);
    }
    return unMonto;
  }

  async obtenerProveedor(cuil) {
    console.log("llegue aca naa mas" + cuil)
    let proveedorEncontrado = await Proveedor.find({ cuilProveedor: cuil });
    if (!proveedorEncontrado[0])
      throw new ErrorDeIncidencia("Intenta ingresar mercaderia a proveedor no autorizado");
    return proveedorEncontrado;
  }

  obtenerStockProducto(idProducto) {
    return this.ProductoSucursal.find(
      (p) => p.idProducto == idProducto
    ).getStock();
  }

  async buscarEmpleado(legajo) {
    return await Empleado.find({ legajo: legajo });
  }

  async agregarProductoTest(unProducto) {
    let sePudo = false;
    let product = await this.buscarProductoPorCodigoBarraSucursal(
      unProducto.codigoBarra
    );

    if (product[0]) {
      throw new Error("El Producto ya se encuentra agregado!");
    } else {
      this.productosDeSucursal.push(unProducto);
      sePudo = true;
    }

    return sePudo;
  }

  async agregarProveedor(res, prov) {
    console.log(prov);
    await prov.save();
  }
  async agregarNotificacion(res, nuevaNotificacion) {
    await nuevaNotificacion.save();
    return true;

  }

  async agregarUsuario(req, res, user, jsonResponse) {

    let userLegajo = await this.buscarUsuarioPorEmail(user.getEmail());

    if (userLegajo.length > 0) {
      
      if(jsonResponse == true){
        res.sendStatus(403);
      } else {
        req.flash('error_msg', "Email existente");
        //throw new Error("El email ya se encuentra asignado a otro empleado!");
      }

      return false;

    } else {
      await user.save();
      return true;
    }
  }

  async agregarProductoSucursal(res, prod) {
    let product = await this.buscarProductoPorCodigoBarraSucursal(
      prod.getCodigoBarra()
    );

    if (product[0]) {
      throw new Error("El Producto Sucursal ya se encuentra registrado!");
    } else {
      await prod.save();
      return true;
    }
  }

  async agregarProductoProveedor(res, prod) {
    let product = await this.buscarProductoPorCodigoBarraProveedor(
      prod.getCodigoBarra()
    );

    if (product[0]) {
      throw new Error("El Producto Proveedor ya se encuentra registrado!");
    } else {
      await prod.save();
      return true;
    }
  }

  async listaDeNotificaciones() {
    return await Notificacion.find().lean();
  }
  async listaDeProveedores() {
    return await Proveedor.find().lean();
  }

  async listaDeUsuarios() {
    return await Empleado.find().lean();
  }

  async listaDeProductosSucursal() {
    return await ProductoSucursal.find().lean();
  }

  async listaDeProductosProveedor() {
    return await ProductoProveedor.find().lean();
  }

  async eliminarUsuario(id) {
    await Empleado.findByIdAndDelete(id);
  }

  async eliminarProveedor(id) {
    await Proveedor.findByIdAndDelete(id);
  }

  async eliminarProductoSucursal(id) {
    await ProductoSucursal.findByIdAndDelete(id);
  }

  async eliminarProductoProveedor(id) {
    await ProductoProveedor.findByIdAndDelete(id);
  }

  async eliminarNotificacion(id) {
    await Notificacion.findByIdAndDelete(id);
  }

  async buscarUsuarioPorId(id) {
    return await Empleado.findById(id).lean();
  }

  async buscarUsuarioPorLegajo(legajo) {
    return await Empleado.find({ legajo: legajo });
  }

  async buscarUsuarioPorEmail(email) {
    return await Empleado.find({ email: email });
  }

  async buscarNotificacionPorId(id) {
    return await Notificacion.findById(id).lean();
  }
  async buscarProductoPorIdSucursal(id) {
    return await ProductoSucursal.findById(id).lean();
  }

  async buscarProductoPorIdProveedor(id) {
    return await ProductoProveedor.findById(id).lean();
  }

  async buscarProductoPorCodigoBarraSucursal(cod) {
    return await ProductoSucursal.find({ codigoBarra: cod });
  }

  async buscarProductoPorCodigoBarraProveedor(cod) {
    return await ProductoProveedor.find({ codigoBarra: cod });
  }

  async editarProveedor(id, params) {
    return await Proveedor.findByIdAndUpdate(id, params);
  }

  async ActualizarStockProducto(unProducto, cant) {
    let idProducto = unProducto._id;
    let cantActualizada = 0;
    cantActualizada = unProducto.stock += parseFloat(cant);
    let productoActualizado = new ProductoSucursal({
      _id: idProducto,
      stock: cantActualizada,
    })
    await this.editarProductoSucursal(idProducto, productoActualizado)
  }

  async editarUsuario(id, params) {
    try {
      return await Empleado.findByIdAndUpdate(id, params);  
    } catch (error) {
      return false; 
    }
  }

  async editarProductoSucursal(id, params) {
    return await ProductoSucursal.findByIdAndUpdate(id, params);
  }

  async editarProductoProveedor(id, params) {
    return await ProductoProveedor.findByIdAndUpdate(id, params);
  }

  getAll() {
    return `Sucursal[idSucursal:${this.idSucursal}, nombreSucursal:${this.nombreSucursal}, ubicacion:${this.ubicacion}, usuarios:${this.usuarios}, productos:${this.productos}]`;
  }

  validarIngreso(cant) {
    const CANT_MIN = 1;
    const CANT_MAX = 1000;
    let pudo = true;
    if (cant < CANT_MIN || cant > CANT_MAX) {
      throw new ErrorDeIncidencia(
        "Intenta ingresar mercaderia fuera de parametros"
      );
    }
    return pudo;
  }

  validarEgreso(cant) {
    const CANT_MIN = 1;
    const CANT_MAX = 50;
    let pudo = true;
    if (cant < CANT_MIN || cant > CANT_MAX) {
      throw new ErrorDeIncidencia(
        "Intenta egresar mercaderia fuera de parametros"
      );
    }
    return pudo;
  }

 async hayStock(unProductoDeSucursal, cant) {
    let pudo = false;
        if(unProductoDeSucursal.stock < cant){
          throw new ErrorDeIncidencia("Esta generando un negativo en el stock!");
        }
        return pudo;
      }
     
    
    }
  


sucursalSchema.loadClass(Sucursal);
module.exports = model("Sucursal", sucursalSchema);
