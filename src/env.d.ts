/**
 * The JS-only SweetAlert2 build has no types of its own (the package ships them for the default
 * entry). Point it at the package's declarations so `Swal` is typed in src/alpine.ts.
 */
declare module 'sweetalert2/dist/sweetalert2.esm.js' {
  import Swal from 'sweetalert2';
  export default Swal;
}
